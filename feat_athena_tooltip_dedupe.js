/*! feat_athena_tooltip_dedupe.js  ->  window.__mlsTooltipDedupe  (v1.1.0)
 * =====================================================================
 * UI FIX — exactly ONE tooltip per day-pull button on hover.
 *
 * PROBLEM (Michael's screenshots): the pull buttons ("Pull today's patients
 * & their history", "Pull from Athena", etc.) show TWO stacked tooltip text
 * boxes on hover instead of one.
 *
 * ROOT CAUSE (read from the live-deployed assets + briefing 73/74/75):
 * each pull button already carries the LEGITIMATE custom card tooltip created
 * by the cardtips features:
 *   - feat_athena_cardtips_mlsac.js (__mlsCardTipsMlsac) -> `.mlsactip-pop`
 *       on the LIVE §64 `data-mlsac` day-pull cards (the variant the doctor
 *       sees: 7 `.mlsac-sub`, 0 `.mlscp-sub`).
 *   - feat_athena_cardtips.js       (__mlsCardTips)      -> `.mlstip-pop`
 *       on the §67 `.mlscp` centerpiece hero pull card (#ezPull).
 * A SECOND tooltip on the SAME button is what stacks. Two mechanisms produce
 * the duplicate, and this asset neutralises BOTH so the fix is correct
 * regardless of which one is firing live:
 *   (A) a NATIVE `title=` attribute left on the pull button (or its label /
 *       sub / a descendant) by the §64 clarity / §67 centerpiece / actions
 *       layer. The browser renders that as its OWN tooltip box, ~1.5s into a
 *       hover, STACKED on top of the custom popover. (Same class of bug as the
 *       §19.3 native-title race, on a newer card variant the stripper missed.)
 *   (B) MORE THAN ONE custom popover on one button (e.g. both `.mlstip-pop`
 *       and `.mlsactip-pop` on the #ezPull hero card, or a duplicate left by a
 *       re-render race) — two custom boxes shown at once.
 *
 * THE FIX (additive, own-scope, fully reversible; owners left byte-exact):
 *   SCOPE — only act on buttons that ALREADY carry a custom cardtips popover
 *   (`.mlstip-pop` / `.mlsactip-pop`) or host class (`.mlstip-host` /
 *   `.mlsactip-host`). This is exactly the set of buttons that have the
 *   legitimate single tooltip, so we never reduce any button to zero tooltips
 *   and never touch a button that only has its own native title.
 *   (A) For such a button, STASH any native `title` or universal `data-tip`
 *       source (on the button or any descendant) and REMOVE it. This prevents
 *       both the browser bubble and the app-wide #mlsTip bubble from stacking
 *       over the richer card explainer. The custom popover remains available on
 *       hover/focus/tap.
 *   (B) If such a button holds >1 custom popover, keep the FIRST and hide the
 *       extras (`display:none` + `data-mlsdd-hidden`) -> exactly one shows.
 *   Re-applied on re-render (MutationObserver childList+subtree+`title` attr,
 *   plus bounded late-mount passes during the initial feature wave),
 *   because the owners re-create the cards (and re-add the native title).
 *
 * It does NOT touch: the custom popover content, the `.mlstip-host` /
 * `.mlsactip-host` anchor classes, `aria-describedby`, the READ-ONLY / WRITES
 * pills, the grey info circle, any button id / handler, or the pull logic.
 * No PHI is read or written — it only removes a redundant static tooltip
 * source. No network. ASCII-only / NUL-free. Idempotent.
 *
 * revert(): disconnects, restores every stashed native `title`, un-hides every
 * hidden duplicate popover, removes the injected style. Restores prior state.
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsTooltipDedupe && W.__mlsTooltipDedupe.installed) return;

  var VERSION = '1.1.0';
  var ASSET = 'feat_athena_tooltip_dedupe.js';
  var STYLE_ID = 'mlsTooltipDedupeStyle';

  // A custom cardtips popover (the legitimate single tooltip) lives under one
  // of these classes; its host button carries one of these host classes.
  var POP_SEL = '.mlstip-pop, .mlsactip-pop';
  var HOST_SEL = '.mlstip-host, .mlsactip-host';

  var TITLE_STASH = 'data-mlsdd-title';   // where we park a removed native title
  var TIP_STASH = 'data-mlsdd-tip';       // where we park a removed universal data-tip
  var DUP_FLAG = 'data-mlsdd-hidden';     // marks a popover we hid as a duplicate

  var stashedTitles = [];  // {el} elements we removed a native title from
  var stashedTips = [];    // {el} elements we removed a universal data-tip from
  var hiddenPops = [];     // {el, prevDisplay} popovers we hid as duplicates
  var addedTips = [];      // {el, value} clarity tips added by this module
  var _obs = null, _raf = 0, _bootTimers = [];
  var _hoverGuardOn = false;

  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    // Belt-and-suspenders: a popover we flagged as a duplicate stays hidden even
    // if an owner re-shows it between our passes. The native title is handled by
    // attribute removal (CSS cannot hide a native title tooltip).
    st.textContent = '[' + DUP_FLAG + ']{display:none !important;}';
    (document.head || document.documentElement).appendChild(st);
  }

  // The cardtips host button for a given popover / host element.
  function hostButtonOf(el) {
    if (!el) return null;
    if (el.closest) {
      var h = el.closest(HOST_SEL);
      if (h) return h;
      var b = el.closest('button,[data-mlsac]');
      if (b) return b;
    }
    var p = el.parentNode;
    while (p && p !== document && !(p.tagName === 'BUTTON')) p = p.parentNode;
    return (p && p.tagName === 'BUTTON') ? p : null;
  }

  // Collect every distinct cardtips host button currently on the page.
  function hostButtons() {
    var set = [];
    var seen = [];
    function add(b) {
      if (!b) return;
      for (var i = 0; i < seen.length; i++) if (seen[i] === b) return;
      seen.push(b); set.push(b);
    }
    try {
      var hosts = document.querySelectorAll(HOST_SEL);
      for (var i = 0; i < hosts.length; i++) add(hosts[i]);
      var pops = document.querySelectorAll(POP_SEL);
      for (var j = 0; j < pops.length; j++) add(hostButtonOf(pops[j]));
    } catch (e) {}
    return set;
  }

  // (A) strip a native title from `el` (stash for revert). Only call on
  // elements inside a confirmed cardtips host.
  function stripTitle(el) {
    try {
      if (!el || !el.getAttribute) return;
      if (el.hasAttribute(TITLE_STASH)) return;        // already handled
      if (!el.hasAttribute('title')) return;
      var t = el.getAttribute('title');
      el.setAttribute(TITLE_STASH, t == null ? '' : t);
      el.removeAttribute('title');
      stashedTitles.push({ el: el });
    } catch (e) {}
  }

  function stripUniversalTip(el) {
    try {
      if (!el || !el.getAttribute || (el.matches && el.matches(POP_SEL))) return;
      if (el.hasAttribute(TIP_STASH) || !el.hasAttribute('data-tip')) return;
      var t = el.getAttribute('data-tip');
      el.setAttribute(TIP_STASH, t == null ? '' : t);
      el.removeAttribute('data-tip');
      stashedTips.push({ el: el });
    } catch (e) {}
  }

  // (B) on a button with >1 custom popover, hide all but the first.
  function dedupePopovers(btn) {
    try {
      if (!btn || !btn.querySelectorAll) return;
      var pops = btn.querySelectorAll(POP_SEL);
      if (pops.length <= 1) return;
      for (var i = 1; i < pops.length; i++) {
        var p = pops[i];
        if (p.getAttribute(DUP_FLAG)) continue;
        hiddenPops.push({ el: p, prevDisplay: p.style.display });
        p.setAttribute(DUP_FLAG, '1');
        p.style.display = 'none';
      }
    } catch (e) {}
  }

  function processButton(btn) {
    if (!btn) return;
    // confirm this button truly has a custom popover before we strip its native
    // title — guarantees we never drop a button to zero tooltips.
    var hasCustom = false;
    try { hasCustom = !!btn.querySelector(POP_SEL); } catch (e) { hasCustom = false; }
    if (!hasCustom) return;
    // (A) the button itself + every descendant (label, sub, pill wrapper) — but
    // never the popover's own elements (popovers carry no title).
    stripTitle(btn);
    stripUniversalTip(btn);
    try {
      var withTitle = btn.querySelectorAll('[title]');
      for (var i = 0; i < withTitle.length; i++) stripTitle(withTitle[i]);
      var withTip = btn.querySelectorAll('[data-tip]');
      for (var j = 0; j < withTip.length; j++) stripUniversalTip(withTip[j]);
    } catch (e) {}
    // (B) collapse duplicate custom popovers to one.
    dedupePopovers(btn);
  }

  function isTabControl(el) {
    try {
      if (!el) return false;
      if (String(el.getAttribute('role') || '').toLowerCase() === 'tab') return true;
      if (el.closest && el.closest('[role="tablist"]')) return true;
      var cls = String(el.className || '').toLowerCase();
      return /(^|[-_\s])(?:nav)?tab(?:[-_\s]|$)/.test(cls);
    } catch (e) { return false; }
  }

  function addTip(el, value) {
    try {
      if (!el || !value || isTabControl(el) || el.hasAttribute('data-tip') || el.hasAttribute('title')) return;
      el.setAttribute('data-tip', value);
      addedTips.push({ el: el, value: value });
    } catch (e) {}
  }

  function seedClarityTips() {
    var byId = {
      mlsTbMenuBtn: 'Open the main menu for tools, setup, and account actions',
      mlsStudyLaunch: 'Build a de-identified patient study or import a patient cohort',
      captureMoreBtn: 'Show extra recording choices, including the phone microphone',
      mlsPhCopy: 'Copy the phone microphone link to your clipboard',
      mlsDsTodayBtn: 'Return the schedule to today',
      mlsDsPullBtn: 'Import the selected day\'s schedule and patient history from athenaOne',
      mipsBtn: 'Check this visit against applicable MIPS quality measures',
      chartSumBtn: 'Generate a concise summary of the active patient\'s chart',
      anaAskBtn: 'Generate an analysis using the currently selected practice data',
      backupRunBtn: 'Create a secure backup of the saved MLS data now',
      tpfReupload: 'Choose the template files again without deleting saved templates',
      tpfReAll: 'Run template processing again for every template marked as needing review',
      tpfMatchBtn: 'Preview which note type MLS would match to each template',
      r44cTunnelGo: 'Open the focused step-by-step visit workflow',
      r44cGbpOpen: 'Open the Google Business Profile setup guide',
      mlsAsstFab: 'Open MLS Assistant for patient, provider, and workflow questions',
      emrBtn: 'Choose which generated sections to review for the EMR'
    };
    Object.keys(byId).forEach(function (id) { addTip(document.getElementById(id), byId[id]); });

    var menuTips = [
      [/\bAsk\b/i, 'Open MLS Copilot to ask questions or find an action'],
      [/Reviews\s*&?\s*reputation/i, 'Manage reviews, listings, and patient review requests'],
      [/Patient intake/i, 'Set up intake questions and review submitted patient forms'],
      [/Templates/i, 'Manage note, procedure, and output templates'],
      [/Custom widget/i, 'Build a reusable AI-filled card for generated visits'],
      [/Troubleshoot Athena/i, 'Check the athenaOne connection and fix common setup problems'],
      [/Use on your phone/i, 'Set up your phone as a secure visit microphone'],
      [/Staff day-prep/i, 'Open the staff workflow for preparing today\'s patient charts'],
      [/Guided tour|How-To Guide|How-to/i, 'Open step-by-step help for using MLS'],
      [/Settings/i, 'Open practice, account, integration, and display settings'],
      [/Log out/i, 'Sign out of MLS on this device'],
      [/Recommendations/i, 'Review AI-generated care recommendations for the active patient'],
      [/Legal requests/i, 'Open attorney requests and medical-legal report work'],
      [/\bTeam\b/i, 'Review team workload, patients, and documentation status']
    ];
    try {
      var items = document.querySelectorAll('.mlsTbItem,[role="menuitem"]');
      for (var i = 0; i < items.length; i++) {
        var text = String(items[i].textContent || '').replace(/\s+/g, ' ').trim();
        for (var j = 0; j < menuTips.length; j++) {
          if (menuTips[j][0].test(text)) { addTip(items[i], menuTips[j][1]); break; }
        }
      }
    } catch (e) {}

    try {
      var prevs = document.querySelectorAll('.cx-mini-prev');
      for (var p = 0; p < prevs.length; p++) addTip(prevs[p], 'Show the previous month');
      var nexts = document.querySelectorAll('.cx-mini-next');
      for (var n = 0; n < nexts.length; n++) addTip(nexts[n], 'Show the next month');
      var closes = document.querySelectorAll('button.modal-x');
      for (var c = 0; c < closes.length; c++) addTip(closes[c], 'Close this window');
      var sections = document.querySelectorAll('button[onclick^="copySection("]');
      for (var s = 0; s < sections.length; s++) {
        var sectionName = String(sections[s].textContent || 'note').trim();
        addTip(sections[s], 'Copy only the ' + sectionName + ' section of the generated note');
      }
      var labeled = document.querySelectorAll('button[aria-label],[role="button"][aria-label]');
      for (var a = 0; a < labeled.length; a++) {
        var visibleText = String(labeled[a].textContent || '').replace(/[\s\u00d7\u2715\u2630\u2190-\u21ff]/g, '');
        if (!visibleText) addTip(labeled[a], labeled[a].getAttribute('aria-label'));
      }
    } catch (e) {}
  }

  function pass() {
    try {
      injectStyle();
      seedClarityTips();
      var btns = hostButtons();
      for (var i = 0; i < btns.length; i++) processButton(btns[i]);
      /* This asset already owns the one document mutation observer. Let the
         visit-control continuation share that pass instead of adding another
         page-wide observer for the patient-bar stability repair. */
      var continuityStyle = document.getElementById('mlsVisitControlContinuityStyle');
      if (continuityStyle && typeof continuityStyle.__mlsStabilizePatientBar === 'function') {
        continuityStyle.__mlsStabilizePatientBar();
      }
    } catch (e) {}
  }

  function schedulePass() {
    if (_raf) return;
    var run = function () { _raf = 0; pass(); };
    _raf = (W.requestAnimationFrame ? W.requestAnimationFrame(run) : setTimeout(run, 16));
  }

  function relevantAddedNode(node) {
    try {
      if (!node || node.nodeType !== 1) return false;
      var sel = HOST_SEL + ',' + POP_SEL + ',.mlsTbItem,[role="menuitem"],.cx-mini-prev,.cx-mini-next,button.modal-x,button[aria-label],[role="button"][aria-label],button[onclick^="copySection("]';
      return !!((node.matches && node.matches(sel)) || (node.querySelector && node.querySelector(sel)));
    } catch (e) { return false; }
  }

  function guardCustomHover(ev) {
    try {
      var el = ev && ev.target && ev.target.closest ? ev.target.closest(HOST_SEL) : null;
      if (el) processButton(el);
    } catch (e) {}
  }

  function hideUniversalOnCustomHover(ev) {
    try {
      if (!ev || !ev.target || !ev.target.closest) return;
      var host = ev.target.closest(HOST_SEL);
      if (!host) return;
      processButton(host);
      var universal = document.getElementById('mlsTip');
      if (universal) universal.style.display = 'none';
    } catch (e) {}
  }

  function cleanCustomExit(ev) {
    try {
      var host = ev && ev.target && ev.target.closest ? ev.target.closest(HOST_SEL) : null;
      if (host) processButton(host);
    } catch (e) {}
  }

  function startObserver() {
    try {
      _obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes' && (m.attributeName === 'title' || m.attributeName === 'data-tip')) {
            var host = hostButtonOf(m.target); if (host) processButton(host);
            continue;
          }
          for (var j = 0; m.addedNodes && j < m.addedNodes.length; j++) {
            if (relevantAddedNode(m.addedNodes[j])) { schedulePass(); return; }
          }
        }
      });
      _obs.observe(document.body || document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-tip']
      });
    } catch (e) {}
    // bounded boot retries cover late initial card owners without an idle poll
    /* Bounded late-mount passes cover the initial feature wave. After that the
       filtered observer and focus/hover guards own updates; there is no
       permanent whole-document tooltip scan. */
    [500,1500,3000].forEach(function (delay) { _bootTimers.push(setTimeout(schedulePass, delay)); });
  }

  function boot() {
    injectStyle();
    pass();
    startObserver();
    if (!_hoverGuardOn) {
      document.addEventListener('mouseover', guardCustomHover, true);
      document.addEventListener('focusin', guardCustomHover, true);
      document.addEventListener('mouseover', hideUniversalOnCustomHover, false);
      document.addEventListener('focusin', hideUniversalOnCustomHover, false);
      document.addEventListener('mouseout', cleanCustomExit, false);
      _hoverGuardOn = true;
    }
  }

  function revert() {
    try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e) {}
    try { _bootTimers.forEach(function (timer) { clearTimeout(timer); }); _bootTimers = []; } catch (e) {}
    if (_hoverGuardOn) {
      try { document.removeEventListener('mouseover', guardCustomHover, true); } catch (e) {}
      try { document.removeEventListener('focusin', guardCustomHover, true); } catch (e) {}
      try { document.removeEventListener('mouseover', hideUniversalOnCustomHover, false); } catch (e) {}
      try { document.removeEventListener('focusin', hideUniversalOnCustomHover, false); } catch (e) {}
      try { document.removeEventListener('mouseout', cleanCustomExit, false); } catch (e) {}
      _hoverGuardOn = false;
    }
    try { if (_raf && W.cancelAnimationFrame) W.cancelAnimationFrame(_raf); } catch (e) {}
    _raf = 0;
    // restore stashed native titles
    stashedTitles.forEach(function (s) {
      try {
        var el = s.el;
        if (el && el.getAttribute && el.hasAttribute(TITLE_STASH)) {
          el.setAttribute('title', el.getAttribute(TITLE_STASH));
          el.removeAttribute(TITLE_STASH);
        }
      } catch (e) {}
    });
    stashedTitles = [];
    stashedTips.forEach(function (s) {
      try {
        var el = s.el;
        if (el && el.getAttribute && el.hasAttribute(TIP_STASH)) {
          el.setAttribute('data-tip', el.getAttribute(TIP_STASH));
          el.removeAttribute(TIP_STASH);
        }
      } catch (e) {}
    });
    stashedTips = [];
    addedTips.forEach(function (s) {
      try { if (s.el && s.el.getAttribute('data-tip') === s.value) s.el.removeAttribute('data-tip'); } catch (e) {}
    });
    addedTips = [];
    // un-hide duplicate popovers we hid
    hiddenPops.forEach(function (h) {
      try {
        var el = h.el;
        if (el) {
          el.removeAttribute(DUP_FLAG);
          el.style.display = h.prevDisplay || '';
        }
      } catch (e) {}
    });
    hiddenPops = [];
    try { var st = document.getElementById(STYLE_ID); if (st) st.remove(); } catch (e) {}
    if (W.__mlsTooltipDedupe) W.__mlsTooltipDedupe.installed = false;
  }

  W.__mlsTooltipDedupe = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    pass: pass,
    processButton: processButton,
    _hostButtons: hostButtons,
    _stashed: function () { return stashedTitles; },
    _stashedTips: function () { return stashedTips; },
    _hidden: function () { return hiddenPops; },
    revert: revert
  };

  try {
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } catch (e) { try { boot(); } catch (e2) {} }
})();

/*! single-owner UI + account access -> window.__mlsUiUnification (v1.0.0)
 * Keeps the easy visit recorder authoritative until the user deliberately
 * opens Advanced, removes duplicate entry points, and puts account/security
 * access in the always-visible top bar. The extension is not involved.
 */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W || (W.__mlsUiUnification && W.__mlsUiUnification.installed)) return;

  var VERSION = '1.1.3';
  var STYLE_ID = 'mlsUiUnificationStyle';
  var ACCOUNT_WRAP_ID = 'mlsAccountAccess';
  var retryTimer = null;
  var retryCount = 0;
  var topObserver = null;
  var visitObserver = null;
  var portalObserver = null;
  var portalMountObserver = null;
  var settingsObserver = null;
  var reconciling = false;
  var initialAdvancedSettled = false;
  var activeSettingsGroup = 'account';
  var settingsWasOpen = false;
  var settingsMoves = [];
  var concernRaf = 0;
  var concernQueue = {};

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function text(el) { return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }

  function injectStyle() {
    if (byId(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      /* When the easy lane owns the Advanced trigger, suppress the second
         legacy toggle below it. If the easy lane is absent, the legacy row
         remains available as the fallback owner. */
      'body.mls-has-easy-advanced-trigger #mlsEz3 .ez3-advrow{display:none!important;}',
      /* The exact active-patient header action is the single portal-invite
         owner. The generic Visit link remains available when no patient is
         selected and the exact action therefore does not exist. */
      'body.mls-has-exact-portal-action #mlsEz3 .ez3-portal{display:none!important;}',
      '#mlsRdMenuSlot{position:relative;}',
      '.mls-account-wrap{position:relative;display:inline-flex;align-items:center;}',
      '#mlsAccountMenuBtn{height:38px;display:inline-flex;align-items:center;gap:8px;border:1px solid #D9D6CD;border-radius:10px;background:#fff;color:#1A211C;padding:0 11px;font:600 13px/1 "Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap;}',
      '#mlsAccountMenuBtn:hover,#mlsAccountMenuBtn[aria-expanded="true"]{background:#F4F2EC;border-color:#BFC9C2;}',
      '.mls-account-avatar{width:23px;height:23px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:#204034;color:#8FD8BE;font-size:11px;font-weight:800;}',
      '.mls-account-pop{position:absolute;right:0;top:calc(100% + 9px);z-index:2147482000;width:260px;background:#fff;border:1px solid #DCE3DE;border-radius:14px;box-shadow:0 18px 48px rgba(20,33,28,.18);padding:9px;font-family:"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;}',
      '.mls-account-pop[hidden]{display:none!important;}',
      '.mls-account-id{padding:8px 9px 10px;border-bottom:1px solid #ECEFEA;margin-bottom:5px;color:#66726A;font-size:12px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.mls-account-action{display:flex;width:100%;align-items:center;gap:9px;border:0;border-radius:9px;background:transparent;color:#1A211C;padding:10px 9px;text-align:left;font:600 13.5px/1.2 "Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;}',
      '.mls-account-action:hover{background:#F4F2EC;}',
      '.mls-account-action.danger{color:#9B3030;}',
      '.mls-password-standard{display:none;margin:-6px 0 14px;color:#66726A;font:500 12px/1.4 "Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;}',
      '.mls-password-standard.is-visible{display:block;}',
      '#settingsModal.mls-settings-clean .modal{padding:28px 32px 92px 258px!important;background:#FBFAF7!important;box-sizing:border-box!important;overflow-y:scroll!important;overflow-x:hidden!important;overflow-anchor:none!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important;scrollbar-width:thin!important;scrollbar-color:#879A8E #ECEDE8!important;}',
      '#settingsModal.mls-settings-clean .modal::-webkit-scrollbar{display:block!important;width:10px!important;height:10px!important;}',
      '#settingsModal.mls-settings-clean .modal::-webkit-scrollbar-track{background:#ECEDE8!important;border-radius:10px!important;}',
      '#settingsModal.mls-settings-clean .modal::-webkit-scrollbar-thumb{background:#879A8E!important;border:2px solid #ECEDE8!important;border-radius:10px!important;}',
      '#settingsModal.mls-settings-clean #settingsTabBar{left:18px!important;right:auto!important;width:214px!important;padding:0 14px 0 0!important;border-left:0!important;border-right:1px solid #E7E5DD!important;background:transparent!important;}',
      '#settingsModal.mls-settings-clean #settingsTabBar .set-tab{border-radius:9px!important;padding:10px 12px!important;color:#55605A!important;font-weight:650!important;}',
      '#settingsModal.mls-settings-clean #settingsTabBar .set-tab:hover{background:#F4F2EC!important;color:#1A211C!important;}',
      '#settingsModal.mls-settings-clean #settingsTabBar .set-tab.on{background:#204034!important;color:#fff!important;box-shadow:none!important;}',
      '#settingsModal.mls-settings-clean .set-section{background:#fff!important;border:1px solid #E7E5DD!important;border-radius:14px!important;padding:18px!important;margin:0 0 14px!important;}',
      '#settingsModal.mls-settings-clean .set-section>.set-head{color:#204034!important;font-size:12.5px!important;margin-bottom:5px!important;}',
      '#settingsModal.mls-settings-clean .set-section>.set-desc{color:#55605A!important;}',
      '#settingsModal.mls-settings-clean .modal>.row{position:sticky;bottom:-92px;z-index:5;background:rgba(251,250,247,.96);border-top:1px solid #E7E5DD;margin:20px -32px -92px;padding:14px 32px 18px;backdrop-filter:blur(8px);}',
      '#settingsModal.mls-settings-clean .mls-settings-moved{border-top:1px solid #EFEDE6;padding-top:14px;margin-top:14px;}',
      /* Settings is a modal workspace. Keep the persistent bottom voice tools
         out of its scrolling surface and sticky footer, then restore them
         automatically when the modal closes. */
      'html body.mls-settings-open.mls-top-voice-tools #mlsCopVoiceBtn,html body.mls-settings-open.mls-top-voice-tools #mlsAsstFab,html body.mls-settings-open.mls-top-voice-tools #mlsDaDock,html body.mls-settings-open #mlsCopVoiceBtn,html body.mls-settings-open #mlsAsstFab,html body.mls-settings-open #mlsDaDock{display:none!important;visibility:hidden!important;pointer-events:none!important;}',
      '.mls-intake-editor{display:grid;gap:8px;margin-top:9px;}',
      '.mls-intake-row{display:grid;grid-template-columns:minmax(0,1fr) 38px;gap:8px;align-items:center;}',
      '.mls-intake-row input{width:100%;min-width:0;}',
      '.mls-intake-remove{height:38px;border:1px solid #E3D6D3;border-radius:9px;background:#fff;color:#9B3030;font-size:17px;cursor:pointer;}',
      '.mls-intake-remove:hover{background:#FFF4F2;}',
      '.mls-intake-add{justify-self:start;margin-top:2px;}',
      '@media(max-width:820px){#settingsModal.mls-settings-clean{padding:8px!important;align-items:flex-start!important;}#settingsModal.mls-settings-clean .modal{padding:24px 24px 88px!important;max-height:calc(100dvh - 16px)!important;}#settingsModal.mls-settings-clean #settingsTabBar{position:static!important;width:auto!important;max-height:none!important;display:flex!important;flex-flow:row nowrap!important;overflow-x:auto!important;overflow-y:visible!important;overscroll-behavior-x:contain!important;border-right:0!important;border-bottom:1px solid #E7E5DD!important;padding:0 0 10px!important;margin:10px 0 16px!important;}#settingsModal.mls-settings-clean #settingsTabBar .set-tab{width:auto!important;flex:0 0 auto!important;}#settingsModal.mls-settings-clean .modal>.row{bottom:-88px;margin:18px -24px -88px;padding:13px 24px 17px;}}',
      '@media(max-width:720px){#mlsAccountMenuBtn .mls-account-label{display:none}#mlsAccountMenuBtn{padding:0 7px}.mls-account-pop{position:fixed;right:12px;top:64px;width:min(280px,calc(100vw - 24px));}}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function accountEmail() {
    return safe(function () {
      return String((W.bkUser && W.bkUser.email) ||
        (W.currentUser && W.currentUser.email) ||
        (typeof W.getSessionEmail === 'function' && W.getSessionEmail()) || '').trim();
    }, '');
  }

  function initials(email) {
    var s = String(email || 'Account').trim();
    return (s.charAt(0) || 'A').toUpperCase();
  }

  function closeAccountMenu() {
    var btn = byId('mlsAccountMenuBtn'), pop = byId('mlsAccountPopover');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (pop) pop.hidden = true;
  }

  function markHidden(el, reason) {
    if (!el || el.getAttribute('data-mls-ui-owner-hidden') === '1') return;
    el.setAttribute('data-mls-ui-owner-hidden', '1');
    el.setAttribute('data-mls-ui-owner-reason', reason || 'duplicate');
    el.style.setProperty('display', 'none', 'important');
  }

  function hideLegacyAccountRows() {
    document.querySelectorAll('#mlsRdNav .mlsRdFootBtn,#mlsTbMenu .mlsTbItem').forEach(function (el) {
      if (/(settings|sign out|log out)$/i.test(text(el))) markHidden(el, 'account-menu');
    });
  }

  function dedupeHowTo() {
    var all = Array.prototype.slice.call(document.querySelectorAll('#mlsTbMenu button'))
      .filter(function (el) {
        return /(how-to guide|guided tour\s*\/\s*how-to)/i.test(text(el)) &&
          safe(function () { return getComputedStyle(el).display !== 'none' && el.offsetParent !== null; }, false);
      });
    for (var i = 1; i < all.length; i++) markHidden(all[i], 'duplicate-how-to');
  }

  function ensureAccountAccess() {
    var slot = byId('mlsRdMenuSlot');
    if (!slot) return false;
    var existing = byId(ACCOUNT_WRAP_ID);
    if (existing && existing.parentNode !== slot) slot.appendChild(existing);
    if (!existing) {
      var email = accountEmail();
      var wrap = document.createElement('div');
      wrap.id = ACCOUNT_WRAP_ID;
      wrap.className = 'mls-account-wrap';
      wrap.innerHTML =
        '<button type="button" id="mlsAccountMenuBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="mlsAccountPopover">' +
          '<span class="mls-account-avatar" aria-hidden="true"></span><span class="mls-account-label">Account</span>' +
        '</button>' +
        '<div id="mlsAccountPopover" class="mls-account-pop" role="menu" hidden>' +
          '<div class="mls-account-id"></div>' +
          '<button type="button" class="mls-account-action" data-account-action="settings" role="menuitem">&#9881; Account &amp; security</button>' +
          '<button type="button" class="mls-account-action danger" data-account-action="logout" role="menuitem">&#9211; Sign out</button>' +
        '</div>';
      slot.appendChild(wrap);
      var btn = wrap.querySelector('#mlsAccountMenuBtn');
      var pop = wrap.querySelector('#mlsAccountPopover');
      wrap.querySelector('.mls-account-avatar').textContent = initials(email);
      wrap.querySelector('.mls-account-id').textContent = email || 'Signed-in MLS account';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var open = pop.hidden;
        pop.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      wrap.querySelector('[data-account-action="settings"]').addEventListener('click', function () {
        closeAccountMenu();
        if (typeof W.openSettings === 'function') safe(function () { W.openSettings(); });
        else if (typeof W.showView === 'function') safe(function () { W.showView('settings'); });
      });
      wrap.querySelector('[data-account-action="logout"]').addEventListener('click', function () {
        closeAccountMenu();
        if (typeof W.logout === 'function') safe(function () { W.logout(); });
      });
    } else {
      var email2 = accountEmail();
      var avatar = existing.querySelector('.mls-account-avatar');
      var id = existing.querySelector('.mls-account-id');
      var nextAvatar = initials(email2), nextId = email2 || 'Signed-in MLS account';
      if (avatar && avatar.textContent !== nextAvatar) avatar.textContent = nextAvatar;
      if (id && id.textContent !== nextId) id.textContent = nextId;
    }
    hideLegacyAccountRows();
    dedupeHowTo();
    return true;
  }

  function closeAdvancedFromEasy(ev) {
    if (!document.body || !document.body.classList.contains('ez3adv')) return false;
    if (ev) {
      ev.preventDefault(); ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    }
    setTimeout(function () {
      var owner = byId('ez3Adv');
      if (owner) safe(function () { owner.click(); });
      setTimeout(reconcileAdvanced, 0);
    }, 0);
    return true;
  }

  function easyAdvancedClick(ev) {
    closeAdvancedFromEasy(ev);
  }

  function reconcileAdvanced() {
    var trigger = document.querySelector('#mlsEz3 .ez3fl-openws');
    var owner = byId('ez3Adv');
    if (!trigger || !owner || !document.body) {
      if (document.body) document.body.classList.remove('mls-has-easy-advanced-trigger');
      return false;
    }
    document.body.classList.add('mls-has-easy-advanced-trigger');
    if (trigger.getAttribute('data-mls-advanced-owner') !== '1') {
      trigger.setAttribute('data-mls-advanced-owner', '1');
      trigger.addEventListener('click', easyAdvancedClick, true);
    }
    var open = document.body.classList.contains('ez3adv');
    if (!initialAdvancedSettled) {
      initialAdvancedSettled = true;
      if (open) {
        safe(function () { owner.click(); });
        open = document.body.classList.contains('ez3adv');
      }
    }
    var nextLabel = open ? 'Hide advanced workspace' : 'Advanced visit workspace';
    if (trigger.textContent !== nextLabel) trigger.textContent = nextLabel;
    if (trigger.getAttribute('aria-expanded') !== (open ? 'true' : 'false')) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (trigger.getAttribute('aria-controls') !== 'captureCard') trigger.setAttribute('aria-controls', 'captureCard');
    return true;
  }

  function reconcilePortalOwner() {
    if (!document.body) return;
    var exact = byId('mlsPortalInviteBtn');
    document.body.classList.toggle('mls-has-exact-portal-action', !!(exact && exact.isConnected));
  }

  function isSignupMode() {
    var confirm = byId('authConfirmField');
    return !!(confirm && safe(function () { return getComputedStyle(confirm).display !== 'none'; }, confirm.style.display !== 'none'));
  }

  function authTabKeydown(ev) {
    if (!ev || !/^(Enter| |Spacebar)$/.test(ev.key)) return;
    ev.preventDefault();
    safe(function () { ev.currentTarget.click(); });
  }

  function reconcileAuth() {
    var login = byId('tabLogin'), signup = byId('tabSignup');
    var tabs = login && login.parentNode;
    if (tabs) tabs.setAttribute('role', 'tablist');
    [login, signup].forEach(function (tab) {
      if (!tab) return;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('tabindex', '0');
      tab.setAttribute('aria-selected', tab.classList.contains('on') ? 'true' : 'false');
      if (tab.getAttribute('data-mls-auth-keyboard') !== '1') {
        tab.setAttribute('data-mls-auth-keyboard', '1');
        tab.addEventListener('keydown', authTabKeydown);
      }
    });

    var signupMode = isSignupMode();
    var pass = byId('authPass'), confirm = byId('authPass2');
    if (pass) {
      if (signupMode) pass.setAttribute('minlength', '8');
      else pass.removeAttribute('minlength'); /* preserve login compatibility */
    }
    if (confirm) confirm.setAttribute('minlength', '8');
    var helper = byId('authPasswordStandard') || byId('mlsPasswordStandard');
    if (!helper && byId('authConfirmField')) {
      helper = document.createElement('p');
      helper.id = 'mlsPasswordStandard';
      helper.className = 'mls-password-standard';
      helper.textContent = 'Use at least 8 characters.';
      byId('authConfirmField').insertAdjacentElement('afterend', helper);
    }
    if (helper) { helper.classList.toggle('is-visible', signupMode); helper.style.display = signupMode ? 'block' : 'none'; }

    ['resetPass', 'resetPass2'].forEach(function (id) {
      var el = byId(id); if (el) el.setAttribute('minlength', '8');
    });
    var note = safe(function () { return document.querySelector('#resetCard .local-note'); }, null);
    if (note) note.innerHTML = '&#128274; Choose a password of at least <b>8 characters</b>. You\'ll log in with it next.';
  }

  function showResetError(message) {
    var err = byId('resetErr');
    if (!err) return;
    err.textContent = message;
    err.classList.add('show');
  }

  function directSettingsSections() {
    var modal = byId('settingsModal');
    return modal ? Array.prototype.slice.call(modal.querySelectorAll('.modal > .set-section')) : [];
  }

  function settingsHeading(section) {
    return text(section && section.querySelector('.set-head'));
  }

  function settingsGroupFor(section) {
    var heading = settingsHeading(section);
    if (/Account & access|Security & privacy/i.test(heading)) return 'account';
    if (/Practice & provider/i.test(heading)) return 'practice';
    if (/Note defaults|AI personalization|Provider preferences/i.test(heading)) return 'notes';
    if (/Display/i.test(heading)) return 'display';
    if (/Features|App tabs/i.test(heading)) return 'features';
    if (/Legal expert profile/i.test(heading)) return 'legal';
    if (/Integrations/i.test(heading)) return 'integrations';
    if (/MLS Controls/i.test(heading)) return 'advanced';
    return '';
  }

  var SETTINGS_GROUPS = [
    { key: 'account', label: 'Account & security' },
    { key: 'practice', label: 'Practice & provider' },
    { key: 'notes', label: 'Notes & AI' },
    { key: 'display', label: 'Display' },
    { key: 'features', label: 'Features & navigation' },
    { key: 'legal', label: 'Legal profile' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'advanced', label: 'Advanced' }
  ];

  function settingsIsLawyer() {
    return safe(function () { return typeof W.isLawyerUser === 'function' && W.isLawyerUser(); }, false);
  }

  function allowedSettingsGroup(key) {
    return !settingsIsLawyer() || key === 'account' || key === 'display';
  }

  function rememberSettingsMove(el) {
    if (!el || el.getAttribute('data-mls-settings-move') === '1') return;
    settingsMoves.push({ el: el, parent: el.parentNode, next: el.nextSibling });
    el.setAttribute('data-mls-settings-move', '1');
  }

  function moveSettingField(el, parent, before) {
    /* insertBefore(el, el) is a DOM mutation even though the visual order is
       unchanged. The old guard missed that case, so Settings could observe
       its own no-op move forever and keep waking every other UI observer. */
    if (!el || !parent || before === el || el.parentNode === parent && (!before || el.nextSibling === before)) return;
    rememberSettingsMove(el);
    parent.insertBefore(el, before || null);
    el.classList.add('mls-settings-moved');
  }

  function closestField(el) {
    return safe(function () { return el && el.closest('.field'); }, null);
  }

  function syncProviderIdentity() {
    var provider = byId('providerName'), legacy = byId('docName');
    if (provider && legacy) legacy.value = String(provider.value || '').trim();
  }

  function providerIdentityInput() {
    syncProviderIdentity();
  }

  function syncIntakeQuestions(editor) {
    var textarea = byId('intakeQuestions');
    editor = editor || byId('mlsIntakeQuestionEditor');
    if (!textarea || !editor) return;
    var values = Array.prototype.slice.call(editor.querySelectorAll('.mls-intake-question'))
      .map(function (input) { return String(input.value || '').trim(); })
      .filter(Boolean);
    textarea.value = values.join('\n');
    editor.setAttribute('data-source', textarea.value);
  }

  function makeIntakeRow(value, editor) {
    var row = document.createElement('div');
    row.className = 'mls-intake-row';
    var input = document.createElement('input');
    input.type = 'text'; input.className = 'mls-intake-question';
    input.placeholder = 'Add a question patients should answer';
    input.value = value || '';
    input.addEventListener('input', function () { syncIntakeQuestions(editor); });
    var remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'mls-intake-remove';
    remove.setAttribute('aria-label', 'Remove intake question'); remove.textContent = '×';
    remove.addEventListener('click', function () {
      row.remove();
      if (!editor.querySelector('.mls-intake-row')) editor.insertBefore(makeIntakeRow('', editor), editor.querySelector('.mls-intake-add'));
      syncIntakeQuestions(editor);
    });
    row.appendChild(input); row.appendChild(remove);
    return row;
  }

  function renderIntakeEditor(editor, force) {
    var textarea = byId('intakeQuestions');
    if (!textarea || !editor) return;
    if (!force && editor.getAttribute('data-source') === textarea.value) return;
    Array.prototype.slice.call(editor.querySelectorAll('.mls-intake-row')).forEach(function (row) { row.remove(); });
    var values = String(textarea.value || '').split(/\r?\n/).map(function (v) { return v.trim(); }).filter(Boolean);
    if (!values.length) values = [''];
    var add = editor.querySelector('.mls-intake-add');
    values.forEach(function (value) { editor.insertBefore(makeIntakeRow(value, editor), add); });
    editor.setAttribute('data-source', textarea.value);
  }

  function ensureIntakeEditor() {
    var textarea = byId('intakeQuestions');
    if (!textarea) return;
    textarea.hidden = true;
    var editor = byId('mlsIntakeQuestionEditor');
    if (!editor) {
      editor = document.createElement('div');
      editor.id = 'mlsIntakeQuestionEditor'; editor.className = 'mls-intake-editor';
      var add = document.createElement('button');
      add.type = 'button'; add.className = 'btn-ghost mls-intake-add'; add.textContent = '+ Add question';
      add.addEventListener('click', function () {
        var row = makeIntakeRow('', editor);
        editor.insertBefore(row, add);
        safe(function () { row.querySelector('input').focus(); });
      });
      editor.appendChild(add);
      textarea.insertAdjacentElement('afterend', editor);
    }
    renderIntakeEditor(editor, false);
  }

  function rearrangeSettingsFields(sections) {
    var sectionByGroup = {};
    sections.forEach(function (section) {
      var key = settingsGroupFor(section);
      if (key && !sectionByGroup[key]) sectionByGroup[key] = section;
    });
    var account = sectionByGroup.account, practice = sectionByGroup.practice;
    var features = sectionByGroup.features;

    var legacyNameField = closestField(byId('docName'));
    if (legacyNameField) markHidden(legacyNameField, 'duplicate-provider-name');
    var provider = byId('providerName'), legacy = byId('docName');
    if (provider && provider.getAttribute('data-mls-provider-sync') !== '1') {
      provider.setAttribute('data-mls-provider-sync', '1');
      provider.addEventListener('input', providerIdentityInput);
      var providerLabel = safe(function () { return document.querySelector('label[for="providerName"]'); }, null);
      if (providerLabel) {
        providerLabel.setAttribute('data-mls-original-label', providerLabel.textContent || '');
        providerLabel.textContent = 'Provider full name — used on notes, booking and reports';
      }
    }
    if (settingsWasOpen === false && provider && legacy) {
      if (!String(provider.value || '').trim() && String(legacy.value || '').trim()) provider.value = legacy.value;
      syncProviderIdentity();
    }

    var specialtyField = closestField(byId('docSpec'));
    if (specialtyField && practice) {
      var firstGrid = practice.querySelector('.set-grid2');
      moveSettingField(specialtyField, practice, firstGrid ? firstGrid.nextSibling : null);
      var specialtyLabel = safe(function () { return specialtyField.querySelector('label[for="docSpec"]'); }, null);
      if (specialtyLabel && !specialtyLabel.getAttribute('data-mls-original-label')) {
        specialtyLabel.setAttribute('data-mls-original-label', specialtyLabel.textContent || '');
        specialtyLabel.textContent = 'Clinical specialty — tailors notes and reports';
      }
    }

    var confirmField = closestField(byId('qolConfirmLogout'));
    var security = sections.filter(function (s) { return /Security & privacy/i.test(settingsHeading(s)); })[0];
    if (confirmField && security) {
      var idleField = closestField(byId('idleMins'));
      moveSettingField(confirmField, security, idleField ? idleField.nextSibling : security.firstChild);
    }

    var intakeField = closestField(byId('intakeQuestions'));
    if (intakeField && practice) moveSettingField(intakeField, practice, null);
    ensureIntakeEditor();

    var groupProcField = closestField(byId('qolGroupProc'));
    if (groupProcField && features) moveSettingField(groupProcField, features, features.querySelector('.field'));
    var routeReviewField = closestField(byId('autoSendEMR'));
    /* The underlying safeguard intentionally forces this legacy automatic
       routing preference off. Do not present a switch that cannot stay on;
       the supervised review remains available from its real workflow. */
    if (routeReviewField) markHidden(routeReviewField, 'retired-automatic-routing-toggle');

    if (account) {
      var desc = account.querySelector('.set-desc');
      if (desc && !desc.getAttribute('data-mls-original-text')) {
        desc.setAttribute('data-mls-original-text', desc.textContent || '');
        desc.textContent = 'Your sign-in, password and AI connection for this account.';
      }
    }
  }

  function updateSettingsFooter(key) {
    var modal = byId('settingsModal');
    var footer = modal && safe(function () { return modal.querySelector('.modal > .row'); }, null);
    if (!footer) return;
    var primary = footer.querySelector('.btn-primary');
    var close = footer.querySelector('.btn-ghost');
    var dedicated = key === 'legal' || key === 'integrations' || key === 'advanced';
    if (primary) {
      if (!primary.getAttribute('data-mls-original-text')) primary.setAttribute('data-mls-original-text', primary.textContent || '');
      var primaryDisplay = dedicated ? 'none' : '';
      if (primary.style.display !== primaryDisplay) primary.style.display = primaryDisplay;
      if (primary.textContent !== 'Save changes') primary.textContent = 'Save changes';
    }
    if (close) {
      if (!close.getAttribute('data-mls-original-text')) close.setAttribute('data-mls-original-text', close.textContent || '');
      var closeLabel = dedicated ? 'Done' : 'Cancel';
      if (close.textContent !== closeLabel) close.textContent = closeLabel;
    }
    if (modal && modal.getAttribute('data-mls-settings-active') !== key) modal.setAttribute('data-mls-settings-active', key);
  }

  function selectSettingsGroup(key, focusTab, resetScroll) {
    var modal = byId('settingsModal'), bar = byId('settingsTabBar');
    if (!modal || !bar || !allowedSettingsGroup(key)) return;
    var body = modal.querySelector('.modal');
    activeSettingsGroup = key;
    directSettingsSections().forEach(function (section) {
      var show = settingsGroupFor(section) === key && allowedSettingsGroup(key);
      if (section.classList.contains('set-tab-hidden') !== !show) section.classList.toggle('set-tab-hidden', !show);
      var sectionDisplay = show ? '' : 'none';
      if (section.style.display !== sectionDisplay) section.style.display = sectionDisplay;
    });
    Array.prototype.slice.call(bar.querySelectorAll('[data-mls-settings-group]')).forEach(function (tab) {
      var on = tab.getAttribute('data-mls-settings-group') === key;
      if (tab.classList.contains('on') !== on) tab.classList.toggle('on', on);
      var selected = on ? 'true' : 'false', tabIndex = on ? '0' : '-1';
      if (tab.getAttribute('aria-selected') !== selected) tab.setAttribute('aria-selected', selected);
      if (tab.getAttribute('tabindex') !== tabIndex) tab.setAttribute('tabindex', tabIndex);
      if (on && focusTab) safe(function () { tab.focus(); });
    });
    var intro = byId('settingsIntro');
    if (intro) {
      var introDisplay = key === 'account' && text(intro) ? '' : 'none';
      if (intro.style.display !== introDisplay) intro.style.display = introDisplay;
    }
    updateSettingsFooter(key);
    /* The browser is the sole owner of Settings scrolling. Background section
       reconciliation performs no scroll writes; only an explicit tab choice
       intentionally starts the newly selected group at the top. */
    if (body && resetScroll === true) {
      body.scrollTop = 0;
    }
  }

  function settingsTabKeydown(ev) {
    var key = ev && ev.key;
    if (!/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(key || '')) return;
    ev.preventDefault();
    var tabs = Array.prototype.slice.call(byId('settingsTabBar').querySelectorAll('[data-mls-settings-group]'));
    var idx = tabs.indexOf(ev.currentTarget);
    if (key === 'Home') idx = 0;
    else if (key === 'End') idx = tabs.length - 1;
    else idx = (idx + (/Right|Down/.test(key) ? 1 : -1) + tabs.length) % tabs.length;
    var target = tabs[idx]; if (target) selectSettingsGroup(target.getAttribute('data-mls-settings-group'), true, true);
  }

  function buildCleanSettingsTabs(sections) {
    var bar = byId('settingsTabBar'); if (!bar) return;
    var present = {};
    sections.forEach(function (section, index) {
      var key = settingsGroupFor(section);
      if (!key) return;
      present[key] = true;
      section.id = section.id || ('mlsSettingsSection' + index);
      section.setAttribute('data-mls-settings-group', key);
      section.setAttribute('data-set-hidden', allowedSettingsGroup(key) ? '0' : '1');
    });
    var groups = SETTINGS_GROUPS.filter(function (group) { return present[group.key] && allowedSettingsGroup(group.key); });
    if (!groups.some(function (group) { return group.key === activeSettingsGroup; })) activeSettingsGroup = groups.length ? groups[0].key : 'account';
    bar.innerHTML = '';
    groups.forEach(function (group) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'set-tab'; btn.setAttribute('role', 'tab');
      btn.setAttribute('data-mls-settings-group', group.key); btn.textContent = group.label;
      btn.addEventListener('click', function () { selectSettingsGroup(group.key, false, true); });
      btn.addEventListener('keydown', settingsTabKeydown);
      bar.appendChild(btn);
    });
    bar.setAttribute('data-mls-settings-clean', '1');
    selectSettingsGroup(activeSettingsGroup, false, false);
  }

  function reconcileSettings() {
    var modal = byId('settingsModal'); if (!modal) return false;
    /* The modal's class is itself observed for open/close. Re-adding an
       already-present class generated an endless observer -> reconcile ->
       class mutation cycle even while Settings was closed. */
    if (!modal.classList.contains('mls-settings-clean')) modal.classList.add('mls-settings-clean');
    var sections = directSettingsSections();
    if (!sections.length) return false;
    var open = modal.classList.contains('show');
    if (document.body) document.body.classList.toggle('mls-settings-open', open);
    rearrangeSettingsFields(sections);
    var bar = byId('settingsTabBar');
    if (bar && (!bar.querySelector('[data-mls-settings-group]') || bar.querySelectorAll('[data-mls-settings-group]').length !== SETTINGS_GROUPS.filter(function (group) {
      return sections.some(function (section) { return settingsGroupFor(section) === group.key; }) && allowedSettingsGroup(group.key);
    }).length)) buildCleanSettingsTabs(sections);
    else selectSettingsGroup(activeSettingsGroup, false, false);
    if (open && !settingsWasOpen) {
      var provider = byId('providerName'), legacy = byId('docName');
      if (provider && legacy) {
        if (!String(provider.value || '').trim() && String(legacy.value || '').trim()) provider.value = legacy.value;
        syncProviderIdentity();
      }
      var editor = byId('mlsIntakeQuestionEditor'); if (editor) renderIntakeEditor(editor, true);
    }
    settingsWasOpen = open;
    /* One canonical lifecycle signal lets small Settings augmentations remount
       without each feature installing its own page-wide observer or poll. */
    safe(function () {
      var ev;
      try { ev = new CustomEvent('mls:settings-reconciled', { detail: { open: open } }); }
      catch (e) { ev = new Event('mls:settings-reconciled'); ev.detail = { open: open }; }
      W.dispatchEvent(ev);
    });
    return true;
  }

  function reconcileAll() {
    if (reconciling) return;
    reconciling = true;
    safe(ensureAccountAccess);
    safe(reconcileAdvanced);
    safe(reconcilePortalOwner);
    safe(reconcileAuth);
    safe(reconcileSettings);
    reconciling = false;
  }

  function scheduleConcern(name) {
    concernQueue[name] = true;
    if (concernRaf) return;
    var run = function () {
      concernRaf = 0;
      var queue = concernQueue; concernQueue = {};
      if (queue.top) safe(ensureAccountAccess);
      if (queue.visit) safe(reconcileAdvanced);
      if (queue.portal) safe(reconcilePortalOwner);
      if (queue.settings) safe(reconcileSettings);
      if (queue.auth) safe(reconcileAuth);
    };
    concernRaf = W.requestAnimationFrame ? W.requestAnimationFrame(run) : setTimeout(run, 16);
  }

  function scheduleReconcile(reset) {
    if (reset) retryCount = 0;
    if (retryTimer) return;
    retryTimer = setTimeout(function run() {
      retryTimer = null;
      reconcileAll();
      if ((!byId('mlsRdTop') || !byId('mlsEz3')) && retryCount++ < 80) retryTimer = setTimeout(run, 250);
      else observeStableRoots();
    }, 0);
  }

  function observeStableRoots() {
    var top = byId('mlsRdTop'), visit = byId('mlsEz3'), portal = byId('mlsCtxBar'), settings = byId('settingsModal');
    if (top && !topObserver) {
      topObserver = new MutationObserver(function () { scheduleConcern('top'); });
      topObserver.observe(top, { childList: true, subtree: true });
    }
    if (visit && !visitObserver) {
      visitObserver = new MutationObserver(function () { scheduleConcern('visit'); });
      visitObserver.observe(visit, { childList: true, subtree: true });
    }
    if (portal && !portalObserver) {
      portalObserver = new MutationObserver(function () { scheduleConcern('portal'); });
      portalObserver.observe(portal, { childList: true, subtree: true });
      scheduleConcern('portal');
    } else if (!portal && !portalMountObserver) {
      var app = byId('appScreen');
      if (app) {
        portalMountObserver = new MutationObserver(function () {
          var mounted = byId('mlsCtxBar'); if (!mounted) return;
          portalMountObserver.disconnect(); portalMountObserver = null;
          if (!portalObserver) {
            portalObserver = new MutationObserver(function () { scheduleConcern('portal'); });
            portalObserver.observe(mounted, { childList: true, subtree: true });
          }
          scheduleConcern('portal');
        });
        portalMountObserver.observe(app, { childList: true });
      }
    }
    if (settings && !settingsObserver) {
      settingsObserver = new MutationObserver(function () { scheduleConcern('settings'); });
      /* Do not observe descendant classes: selected-tab classes are our own
         output and previously fed back into another rebuild and scroll reset. */
      settingsObserver.observe(settings, { attributes: true, attributeFilter: ['class'] });
      var settingsBody = settings.querySelector('.modal');
      if (settingsBody) settingsObserver.observe(settingsBody, { childList: true });
    }
  }

  function onDocumentClick(ev) {
    var target = ev && ev.target;
    if (!target) return;
    if (safe(function () { return !!target.closest('#tabLogin,#tabSignup'); }, false)) {
      setTimeout(function () { scheduleConcern('auth'); }, 0);
      return;
    }
    if (target.id === 'authBtn' || safe(function () { return !!target.closest('#authBtn'); }, false)) {
      if (isSignupMode()) {
        var signupPass = byId('authPass');
        if (!signupPass || String(signupPass.value || '').length < 8) {
          ev.preventDefault(); ev.stopPropagation();
          if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
          if (typeof W.showAuthErr === 'function') W.showAuthErr('Password must be at least 8 characters.');
          return;
        }
      }
      initialAdvancedSettled = false;
      scheduleConcern('auth');
      setTimeout(function () { scheduleConcern('auth'); }, 500);
      setTimeout(function () { scheduleConcern('auth'); }, 1400);
      return;
    }
    if (target.id === 'resetBtn' || safe(function () { return !!target.closest('#resetBtn'); }, false)) {
      var resetPass = byId('resetPass');
      if (!resetPass || String(resetPass.value || '').length < 8) {
        ev.preventDefault(); ev.stopPropagation();
        if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
        showResetError('Password must be at least 8 characters.');
        return;
      }
    }
    var settingsSave = safe(function () { return target.closest('#settingsModal .modal > .row .btn-primary'); }, null);
    if (settingsSave) {
      syncProviderIdentity();
      syncIntakeQuestions();
    }
    /* Settings controls own their own work; do not launch a whole-site
       reconciliation after every checkbox, select, or button click. */
    if (safe(function () { return !!target.closest('#settingsModal'); }, false)) return;
    var trigger = safe(function () { return target.closest('.ez3fl-openws'); }, null);
    if (trigger) {
      if (closeAdvancedFromEasy(ev)) return;
      setTimeout(reconcileAdvanced, 0);
      return;
    }
    if (!safe(function () { return !!target.closest('#' + ACCOUNT_WRAP_ID); }, false)) closeAccountMenu();
  }

  function boot() {
    injectStyle();
    document.addEventListener('click', onDocumentClick, true);
    scheduleReconcile(true);
  }

  function revert() {
    document.removeEventListener('click', onDocumentClick, true);
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (concernRaf) { if (W.cancelAnimationFrame) W.cancelAnimationFrame(concernRaf); else clearTimeout(concernRaf); concernRaf = 0; }
    concernQueue = {};
    if (topObserver) { topObserver.disconnect(); topObserver = null; }
    if (visitObserver) { visitObserver.disconnect(); visitObserver = null; }
    if (portalObserver) { portalObserver.disconnect(); portalObserver = null; }
    if (portalMountObserver) { portalMountObserver.disconnect(); portalMountObserver = null; }
    if (settingsObserver) { settingsObserver.disconnect(); settingsObserver = null; }
    var wrap = byId(ACCOUNT_WRAP_ID); if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    var helper = byId('mlsPasswordStandard'); if (helper && helper.parentNode) helper.parentNode.removeChild(helper);
    [byId('tabLogin'), byId('tabSignup')].forEach(function (tab) {
      if (!tab) return;
      tab.removeEventListener('keydown', authTabKeydown);
      tab.removeAttribute('role'); tab.removeAttribute('tabindex'); tab.removeAttribute('aria-selected'); tab.removeAttribute('data-mls-auth-keyboard');
    });
    document.querySelectorAll('[data-mls-advanced-owner="1"]').forEach(function (trigger) {
      trigger.removeEventListener('click', easyAdvancedClick, true);
      trigger.removeAttribute('data-mls-advanced-owner');
    });
    var intakeEditor = byId('mlsIntakeQuestionEditor'); if (intakeEditor && intakeEditor.parentNode) intakeEditor.parentNode.removeChild(intakeEditor);
    var intakeTextarea = byId('intakeQuestions'); if (intakeTextarea) intakeTextarea.hidden = false;
    var provider = byId('providerName'); if (provider) { provider.removeEventListener('input', providerIdentityInput); provider.removeAttribute('data-mls-provider-sync'); }
    document.querySelectorAll('[data-mls-original-label]').forEach(function (label) {
      label.textContent = label.getAttribute('data-mls-original-label') || '';
      label.removeAttribute('data-mls-original-label');
    });
    document.querySelectorAll('[data-mls-original-text]').forEach(function (el) {
      el.textContent = el.getAttribute('data-mls-original-text') || '';
      el.removeAttribute('data-mls-original-text');
    });
    for (var sm = settingsMoves.length - 1; sm >= 0; sm--) {
      var move = settingsMoves[sm];
      if (move.el && move.parent) move.parent.insertBefore(move.el, move.next && move.next.parentNode === move.parent ? move.next : null);
      if (move.el) { move.el.removeAttribute('data-mls-settings-move'); move.el.classList.remove('mls-settings-moved'); }
    }
    settingsMoves = [];
    var settingsModal = byId('settingsModal');
    if (document.body) document.body.classList.remove('mls-settings-open');
    if (settingsModal) {
      settingsModal.classList.remove('mls-settings-clean'); settingsModal.removeAttribute('data-mls-settings-active');
      var settingsIntro = byId('settingsIntro'); if (settingsIntro) settingsIntro.style.removeProperty('display');
      var settingsFooter = safe(function () { return settingsModal.querySelector('.modal > .row'); }, null);
      if (settingsFooter) Array.prototype.slice.call(settingsFooter.querySelectorAll('button')).forEach(function (button) {
        button.style.removeProperty('display');
      });
      directSettingsSections().forEach(function (section) {
        section.style.removeProperty('display'); section.classList.remove('set-tab-hidden'); section.removeAttribute('data-mls-settings-group');
      });
    }
    var settingsBar = byId('settingsTabBar'); if (settingsBar) settingsBar.removeAttribute('data-mls-settings-clean');
    safe(function () { if (typeof W.mlsBuildSettingsTabs === 'function') W.mlsBuildSettingsTabs(); });
    document.querySelectorAll('[data-mls-ui-owner-hidden="1"]').forEach(function (el) {
      el.style.removeProperty('display');
      el.removeAttribute('data-mls-ui-owner-hidden');
      el.removeAttribute('data-mls-ui-owner-reason');
    });
    if (document.body) {
      document.body.classList.remove('mls-has-easy-advanced-trigger');
      document.body.classList.remove('mls-has-exact-portal-action');
    }
    var st = byId(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st);
    if (W.__mlsUiUnification) W.__mlsUiUnification.installed = false;
  }

  W.__mlsUiUnification = {
    installed: true,
    version: VERSION,
    reconcile: reconcileAll,
    reconcileSettings: reconcileSettings,
    closeAccountMenu: closeAccountMenu,
    revert: revert
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  } catch (e) { safe(boot); }
})();

/*! visit-control continuity -> window.__mlsVisitControlContinuity (v1.0.0)
 * Keeps the three desktop voice controls stable when the inline Quick Tools
 * lane enters/leaves the viewport. Athena tab is intentionally untouched.
 * Also makes the buried Quick Tools actions open their real in-place dialogs
 * instead of expanding and scrolling the advanced visit workspace.
 */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W || (W.__mlsVisitControlContinuity && W.__mlsVisitControlContinuity.installed)) return;

  var VERSION = '1.0.0';
  var STYLE_ID = 'mlsVisitControlContinuityStyle';
  var MODAL_ID = 'mlsQuickToolPopup';
  var phoneSyncT = null;
  var priorFocus = null;
  var dayStableText = '';
  var dayBusy = false;
  var dayProgressNode = null;
  var dayAgendaNode = null;

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function toast(msg, kind) {
    safe(function () {
      if (typeof W.toast === 'function') W.toast(msg, kind || '');
    });
  }

  function injectContinuityStyle() {
    if (byId(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      /* The legacy handoff class may continue to update for inline chip state,
         but it can no longer hide these three fixed desktop controls. */
      '@media (min-width:761px){',
      'html body.mls-top-voice-tools #mlsCopVoiceBtn,',
      'html body.mls-top-voice-tools #mlsAsstFab,',
      'html body.mls-top-voice-tools #mlsDaDock{display:inline-flex!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;}',
      '}',
      /* The legacy day-progress renderer briefly replaces the provider-scoped
         label every 15 seconds. Cap the intrinsic pill instead of reserving a
         full flex column: the label stays stable without becoming a blue bar
         across the header. The next-patient name may ellipsize on narrow bars,
         while the seen/remaining counts stay visible. */
      '#mlsCtxBar>#mlsDayProgress{box-sizing:border-box;flex:0 1 auto;min-width:0;max-width:min(361px,100%);width:max-content;align-self:flex-start;overflow:hidden;justify-content:flex-start;}',
      '#mlsCtxBar>#mlsDayProgress .mdp-next{min-width:0;overflow:hidden;text-overflow:ellipsis;}',
      '#mlsCtxBar>#mlsRecentPts{box-sizing:border-box;flex:0 0 auto;min-width:max-content;max-width:100%;align-self:flex-start;}',
      '#mlsCtxBar>#mlsRecentPts .mrp-btn{max-width:100%;}',
      'body.mls-has-active-pt #patientBar>#mlsDayProgress,body.mls-has-active-pt #patientBar>#mlsAgendaChip{display:none!important;}',
      /* The Copilot dock owns the full viewport-height sidebar. Let its chat
         thread absorb the available space and keep a full-width composer at
         the bottom instead of bunching every control at the top. */
      '#copilotDockBody{min-height:0;overflow:hidden!important;padding:0!important;display:flex!important;flex-direction:column;}',
      '#copilotDockBody>#copilotCard{box-sizing:border-box;display:flex!important;flex:1 1 auto!important;flex-direction:column;min-height:0!important;max-height:none!important;height:100%!important;width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;border:0!important;border-radius:0!important;}',
      '#copilotDockBody #copilotHero{box-sizing:border-box;order:1;flex:0 0 auto!important;width:100%;margin:0!important;padding:18px 16px!important;border-radius:0!important;}',
      '#copilotDockBody #copilotThread{box-sizing:border-box;order:2;flex:1 1 auto!important;min-height:120px!important;max-height:none!important;width:100%;margin:0!important;padding:14px!important;overflow-y:auto!important;}',
      '#copilotDockBody #copilotChips{box-sizing:border-box;order:3;flex:0 0 auto!important;width:100%;margin:0!important;padding:8px 12px 4px!important;}',
      '#copilotDockBody #copilotCard>.note{box-sizing:border-box;order:4;flex:0 0 auto!important;width:100%;margin:0!important;padding:8px 14px 0!important;background:#fff;}',
      '#copilotDockBody #copilotInputRow{box-sizing:border-box;order:5;flex:0 0 auto!important;display:grid!important;grid-template-columns:minmax(0,1fr) 46px 46px;align-items:end;gap:8px;width:100%;margin:0!important;padding:10px 12px 12px!important;border-top:1px solid #E7E5DD;background:#fff;}',
      '#copilotDockBody #copilotInput{box-sizing:border-box;width:100%!important;min-width:0!important;margin:0!important;}',
      '#copilotDockBody #copilotMicBtn,#copilotDockBody #copilotSendBtn{box-sizing:border-box;width:46px!important;height:46px!important;margin:0!important;padding:0!important;}',
      '.mls-qtp-overlay{position:fixed;inset:0;z-index:2147483200;background:rgba(20,31,25,.48);display:flex;align-items:center;justify-content:center;padding:20px;}',
      '.mls-qtp-card{width:min(640px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#fff;color:#1A211C;border:1px solid #DCE4DE;border-radius:18px;box-shadow:0 24px 70px rgba(17,35,25,.28);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;}',
      '.mls-qtp-head{display:flex;align-items:flex-start;gap:12px;padding:18px 20px 13px;border-bottom:1px solid #E6ECE8;}',
      '.mls-qtp-headcopy{min-width:0;flex:1;}',
      '.mls-qtp-head h3{margin:0;font-size:19px;line-height:1.25;}',
      '.mls-qtp-sub{margin-top:4px;color:#66726A;font-size:13px;line-height:1.45;}',
      '.mls-qtp-x{border:1px solid #D7DFD9;background:#fff;color:#34423A;border-radius:9px;width:34px;height:34px;cursor:pointer;font-size:20px;line-height:1;}',
      '.mls-qtp-body{padding:18px 20px;}',
      '.mls-qtp-foot{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;padding:13px 20px 18px;}',
      '.mls-qtp-btn{border:1px solid #D4DDD7;background:#fff;color:#254B38;border-radius:10px;padding:9px 14px;font-weight:700;cursor:pointer;}',
      '.mls-qtp-btn.primary{border-color:#245C42;background:#245C42;color:#fff;}',
      '.mls-qtp-btn.danger{color:#A33636;}',
      '.mls-qtp-textarea{display:block;width:100%;min-height:220px;resize:vertical;box-sizing:border-box;border:1px solid #CAD5CE;border-radius:11px;padding:12px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1A211C;background:#FCFDFB;}',
      '.mls-qtp-note{font-size:12.5px;line-height:1.45;color:#68746C;margin-top:9px;}',
      '.mls-qtp-phone{display:grid;grid-template-columns:minmax(0,1fr) 190px;gap:18px;align-items:center;}',
      '.mls-qtp-code{font:800 34px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:4px;margin:7px 0;}',
      '.mls-qtp-link{display:block;color:#245C42;font-size:12px;word-break:break-all;}',
      '.mls-qtp-qr{width:180px;height:180px;border:1px solid #D7DFD9;border-radius:10px;background:#F5F7F5;object-fit:contain;}',
      '.mls-qtp-orders{border:1px solid #D7E4F3;background:#F5F9FE;border-radius:12px;padding:13px;min-height:54px;}',
      '@media (max-width:620px){.mls-qtp-phone{grid-template-columns:1fr}.mls-qtp-qr{justify-self:center}}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function clearPhoneSync() {
    if (phoneSyncT) { clearInterval(phoneSyncT); phoneSyncT = null; }
  }

  function closePopup() {
    clearPhoneSync();
    var old = byId(MODAL_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var focus = priorFocus; priorFocus = null;
    safe(function () { if (focus && document.documentElement.contains(focus)) focus.focus(); });
  }

  function popup(title, subtitle) {
    closePopup();
    priorFocus = safe(function () { return document.activeElement; }, null);
    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.className = 'mls-qtp-overlay';
    overlay.innerHTML =
      '<section class="mls-qtp-card" role="dialog" aria-modal="true" aria-labelledby="mlsQtpTitle">' +
        '<header class="mls-qtp-head"><div class="mls-qtp-headcopy"><h3 id="mlsQtpTitle"></h3><div class="mls-qtp-sub"></div></div>' +
        '<button type="button" class="mls-qtp-x" aria-label="Close">&times;</button></header>' +
        '<div class="mls-qtp-body"></div><footer class="mls-qtp-foot"></footer>' +
      '</section>';
    overlay.querySelector('#mlsQtpTitle').textContent = title;
    overlay.querySelector('.mls-qtp-sub').textContent = subtitle || '';
    overlay.querySelector('.mls-qtp-x').addEventListener('click', closePopup);
    overlay.addEventListener('mousedown', function (ev) { if (ev.target === overlay) closePopup(); });
    document.body.appendChild(overlay);
    safe(function () { overlay.querySelector('.mls-qtp-x').focus(); });
    return {
      overlay: overlay,
      body: overlay.querySelector('.mls-qtp-body'),
      foot: overlay.querySelector('.mls-qtp-foot')
    };
  }

  function button(label, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'mls-qtp-btn' + (cls ? ' ' + cls : ''); b.textContent = label;
    b.addEventListener('click', fn); return b;
  }

  function dispatchInput(el) {
    if (!el) return;
    safe(function () { el.dispatchEvent(new Event('input', { bubbles: true })); });
    safe(function () { el.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  function openPasteTranscript() {
    var ui = popup('Paste a transcript', 'Paste or type the visit conversation here. It stays attached to the current visit; nothing is generated until you choose Generate note.');
    var ta = document.createElement('textarea');
    ta.className = 'mls-qtp-textarea';
    ta.setAttribute('aria-label', 'Visit transcript');
    var top = byId('ez3flTranscript'), real = byId('transcript');
    ta.value = (top && top.value) || (real && real.value) || '';
    ui.body.appendChild(ta);
    var note = document.createElement('div'); note.className = 'mls-qtp-note';
    note.textContent = 'This only updates the transcript. It does not draft, sign, or send anything.';
    ui.body.appendChild(note);
    ui.foot.appendChild(button('Cancel', '', closePopup));
    ui.foot.appendChild(button('Use this transcript', 'primary', function () {
      var value = ta.value;
      real = byId('transcript'); top = byId('ez3flTranscript');
      if (real) { real.value = value; dispatchInput(real); }
      if (top) { top.value = value; dispatchInput(top); }
      safe(function () { if (typeof W._markVisitDirty === 'function') W._markVisitDirty(); });
      closePopup();
      toast('Transcript added to this visit.', 'ok');
    }));
    setTimeout(function () { safe(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }); }, 0);
  }

  function syncPhonePopup(ui) {
    var code = byId('phoneMicCode'), link = byId('phoneMicLink'), qr = byId('phoneMicQR');
    var codeText = String((code && code.textContent) || '').trim();
    var href = String((link && (link.href || link.textContent)) || '').trim();
    var src = String((qr && qr.src) || '').trim();
    var ready = !!(codeText && !/^[-]+$/.test(codeText) && href && href !== '#');
    var status = ui.body.querySelector('[data-qtp-phone-status]');
    var codeOut = ui.body.querySelector('[data-qtp-phone-code]');
    var linkOut = ui.body.querySelector('[data-qtp-phone-link]');
    var qrOut = ui.body.querySelector('[data-qtp-phone-qr]');
    if (status) status.textContent = ready ? 'Ready. Scan the code or open the secure link on your phone.' : 'Preparing a secure phone link...';
    if (codeOut) codeOut.textContent = ready ? codeText : '------';
    if (linkOut) { linkOut.textContent = ready ? href : ''; linkOut.href = ready ? href : '#'; }
    if (qrOut) { if (src && src !== location.href) qrOut.src = src; qrOut.style.opacity = ready ? '1' : '.35'; }
    return ready;
  }

  function startPhonePairing() {
    if (typeof W.startPhoneMic === 'function') { safe(function () { W.startPhoneMic(); }); return true; }
    var real = byId('phoneMicBtn');
    if (real) { safe(function () { real.click(); }); return true; }
    toast('Phone recording is not available on this screen yet.', 'err');
    return false;
  }

  function openPhonePopup() {
    var ui = popup('Record on phone', 'Pair your phone as the microphone for the active patient and visit.');
    ui.body.innerHTML =
      '<div class="mls-qtp-phone"><div><div data-qtp-phone-status>Preparing a secure phone link...</div>' +
      '<div class="mls-qtp-code" data-qtp-phone-code>------</div>' +
      '<a class="mls-qtp-link" data-qtp-phone-link href="#" target="_blank" rel="noopener"></a>' +
      '<div class="mls-qtp-note">The phone transcript feeds this visit only. Confirm the active patient before recording.</div></div>' +
      '<img class="mls-qtp-qr" data-qtp-phone-qr alt="QR code for phone recording"></div>';
    ui.foot.appendChild(button('Close', '', closePopup));
    ui.foot.appendChild(button('Stop phone mic', 'danger', function () {
      safe(function () { if (typeof W.stopPhoneMic === 'function') W.stopPhoneMic(); });
      closePopup();
    }));
    ui.foot.appendChild(button('Try again', 'primary', startPhonePairing));
    var alreadyReady = syncPhonePopup(ui);
    if (!alreadyReady) startPhonePairing();
    phoneSyncT = setInterval(function () {
      if (!byId(MODAL_ID)) { clearPhoneSync(); return; }
      syncPhonePopup(ui);
    }, 250);
  }

  function openAfterVisitSummary() {
    var avs = safe(function () { return W.__mlsAfterVisitSummary; }, null);
    if (avs && typeof avs.open === 'function') { safe(function () { avs.open(); }); return; }
    var real = byId('mlsavsBtn');
    if (real) { safe(function () { real.click(); }); return; }
    toast('After-visit summary is still loading. Try again in a moment.', 'err');
  }

  function refreshOrdersPopup(ui) {
    safe(function () { if (typeof W.renderVisitOrders === 'function') W.renderVisitOrders(); });
    var source = byId('visitOrdersBody');
    var host = ui.body.querySelector('.mls-qtp-orders');
    if (!host) return;
    host.innerHTML = source && String(source.innerHTML || '').trim()
      ? source.innerHTML
      : '<span style="font-size:13px;color:#66726A">No orders are staged for this visit yet.</span>';
  }

  function openOrdersPopup() {
    var ui = popup('Orders for this visit', 'Review the orders tied to the current visit. Nothing is sent until you complete the separate Athena review and confirmation.');
    var host = document.createElement('div'); host.className = 'mls-qtp-orders'; ui.body.appendChild(host);
    host.addEventListener('click', function () { setTimeout(function () { refreshOrdersPopup(ui); }, 80); });
    refreshOrdersPopup(ui);
    ui.foot.appendChild(button('Close', '', closePopup));
    ui.foot.appendChild(button('Add or manage orders', 'primary', function () {
      closePopup();
      if (typeof W.showView === 'function') safe(function () { W.showView('orders'); });
      else toast('The Orders page is still loading. Try again in a moment.', 'err');
    }));
  }

  function quickAction(btn) {
    var text = String((btn && btn.textContent) || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.indexOf('paste a transcript') >= 0) return openPasteTranscript;
    if (text.indexOf('record on phone') >= 0) return openPhonePopup;
    if (text.indexOf('after-visit summary') >= 0) return openAfterVisitSummary;
    if (/\borders\b/.test(text)) return openOrdersPopup;
    return null;
  }

  function onQuickToolClick(ev) {
    var btn = safe(function () { return ev.target.closest('.ez3fl-quick .ez3fl-qchip'); }, null);
    var action = quickAction(btn);
    if (!action) return; // Copilot Voice, Assistant, and Dictate keep their real owners.
    safe(function () { ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation(); });
    action();
  }

  function onKeydown(ev) {
    if (ev && ev.key === 'Escape' && byId(MODAL_ID)) closePopup();
  }

  function progressCounts(text) {
    var m = String(text || '').match(/(\d+)\s*\/\s*(\d+)\s+seen/i);
    return m ? { seen: parseInt(m[1], 10), total: parseInt(m[2], 10) } : null;
  }

  function stabilizePatientBar() {
    if (dayBusy) return;
    dayBusy = true;
    try {
      var active = document.body && document.body.classList.contains('mls-has-active-pt');
      var ctx = byId('mlsCtxBar');
      var progress = byId('mlsDayProgress') || dayProgressNode;
      var agenda = byId('mlsAgendaChip') || dayAgendaNode;
      if (progress) dayProgressNode = progress;
      if (agenda) dayAgendaNode = agenda;
      /* A transient hidden-state check in the two legacy renderers can move
         or remove these chips even though the active-patient bar still owns
         the page. Retain and return the SAME nodes before paint so flex never
         loses a column and never gets a chance to reorient. */
      if (active && ctx) {
        var anchor = ctx.querySelector('.mlsctx-actions');
        if (progress && progress.parentNode !== ctx) ctx.insertBefore(progress, anchor || null);
        if (agenda && agenda.parentNode !== ctx) ctx.insertBefore(agenda, anchor || null);
      }
      var txt = progress && progress.querySelector('.mdp-txt');
      if (txt) {
        var current = String(txt.textContent || '').replace(/\s+/g, ' ').trim();
        var currentCounts = progressCounts(current);
        var stableCounts = progressCounts(dayStableText);
        if (/\bremaining\b/i.test(current)) {
          dayStableText = current;
        } else if (currentCounts) {
          /* The short legacy label is a temporary writer, not a new state.
             Preserve a matching provider-scoped label; when counts genuinely
             changed, build its final-width equivalent immediately. */
          if (stableCounts && stableCounts.seen === currentCounts.seen && stableCounts.total === currentCounts.total) {
            txt.textContent = dayStableText;
          } else {
            var suffix = /all providers/i.test(dayStableText) ? ' · all providers' : '';
            dayStableText = currentCounts.seen + ' / ' + currentCounts.total + ' seen · ' +
              Math.max(0, currentCounts.total - currentCounts.seen) + ' remaining' + suffix;
            txt.textContent = dayStableText;
          }
        }
      }
    } catch (e) {}
    dayBusy = false;
  }

  function bootContinuity() {
    injectContinuityStyle();
    var st = byId(STYLE_ID);
    if (st) st.__mlsStabilizePatientBar = stabilizePatientBar;
    document.addEventListener('click', onQuickToolClick, true);
    document.addEventListener('keydown', onKeydown, true);
    stabilizePatientBar();
  }

  function revertContinuity() {
    document.removeEventListener('click', onQuickToolClick, true);
    document.removeEventListener('keydown', onKeydown, true);
    dayStableText = ''; dayBusy = false; dayProgressNode = null; dayAgendaNode = null;
    closePopup();
    var st = byId(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st);
    if (W.__mlsVisitControlContinuity) W.__mlsVisitControlContinuity.installed = false;
  }

  W.__mlsVisitControlContinuity = {
    installed: true,
    version: VERSION,
    openPasteTranscript: openPasteTranscript,
    openPhonePopup: openPhonePopup,
    openAfterVisitSummary: openAfterVisitSummary,
    openOrdersPopup: openOrdersPopup,
    stabilizePatientBar: stabilizePatientBar,
    close: closePopup,
    revert: revertContinuity
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootContinuity, { once: true });
    else bootContinuity();
  } catch (e) { safe(bootContinuity); }
})();
