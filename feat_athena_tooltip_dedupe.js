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
 *   plus a 1500ms safety poll matching the §64/§66/§67 owners' cadence),
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
  var _obs = null, _raf = 0, _pollT = null;
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
    } catch (e) {}
  }

  function schedulePass() {
    if (_raf) return;
    var run = function () { _raf = 0; pass(); };
    _raf = (W.requestAnimationFrame ? W.requestAnimationFrame(run) : setTimeout(run, 16));
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
          if (m.type === 'attributes' && (m.attributeName === 'title' || m.attributeName === 'data-tip')) { schedulePass(); return; }
          if (m.addedNodes && m.addedNodes.length) { schedulePass(); return; }
        }
      });
      _obs.observe(document.body || document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['title', 'data-tip']
      });
    } catch (e) {}
    // slow safety poll mirrors the §64/§66/§67 owners' 1500ms re-render cadence
    _pollT = setInterval(function () { schedulePass(); }, 1500);
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
    try { if (_pollT) { clearInterval(_pollT); _pollT = null; } } catch (e) {}
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
