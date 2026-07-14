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
         label every 15 seconds. Reserve the final width so that write cannot
         collapse and reflow the patient bar while the second writer settles. */
      '#mlsCtxBar>#mlsDayProgress{box-sizing:border-box;flex:0 0 361px;min-width:361px;justify-content:flex-start;}',
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
      '@media (max-width:900px){#mlsCtxBar>#mlsDayProgress{flex:1 1 100%;min-width:0;width:100%;max-width:100%;overflow:hidden;}}',
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
