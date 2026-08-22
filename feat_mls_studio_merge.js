/* MLS Studio Merge — sm-1.0.0
 *
 * Owner, 2026-07-26: "add the analysis tab to the ai studio tab smartly".
 *
 * AI Studio becomes the ONE destination for practice intelligence: asking the
 * Copilot, reading the practice, and building tools. Analysis stops being a
 * separate tab and becomes a section of it.
 *
 * WHY IT IS A SECTION SWITCHER AND NOT A LONGER PAGE.
 * Stacking Analysis under AI Studio would have been two pages stapled: 15 + 18
 * controls on one scroll, three competing primaries, and the contract's law 3
 * broken by construction ("if two actions compete, the screen is wrong"). Three
 * sections, one visible at a time, each with exactly one primary, is the merge
 * that survives the one-minute test.
 *
 * ARCHITECTURE — read this before changing anything.
 *
 * #studioView and #analysisView are BOTH already owned by design-exact rebuild
 * modules, and neither may be fought:
 *
 *   sx-2.4.0-prod (feat_mls_studio_exact.js) turns #studioView into a two-column
 *   CSS GRID and places its children by grid-column/grid-row. Measured live:
 *     .sx-title      gc 1/-1  gr 1        #mlsB39SgWrap  gc 1/-1  gr 3
 *     #copilotCard   gc 1     gr 4        .sx-right      gc 2     gr 4
 *     #studioResultCard gc 1/-1 gr 6      .uc1-pay-wrap  gc 2     gr 5
 *   So every section member is a DIRECT CHILD of the grid. Re-parenting any of
 *   them into a section <div> would strip its grid placement and collapse the
 *   layout. Nothing is re-parented here except #analysisView itself.
 *
 *   ax-3.0.0 (feat_mls_analysis_exact.js) turns #analysisView into a draggable
 *   4-column tile grid and wraps every .card in it, refreshed by its own
 *   MutationObserver. Moving the CARDS out would fight it forever. Moving the
 *   WHOLE #analysisView element does not: every ax selector is id-anchored
 *   (#analysisView.ax-grid ...), so the grid keeps working wherever the element
 *   lives. That is the entire trick this module rests on.
 *
 * VISIBILITY is by class, never inline, and every rule is !important on
 * purpose: sx declares `display:flex!important` on #copilotCard and .sx-right,
 * and ax declares `display:grid!important` on #analysisView. A non-important
 * rule here would lose silently and this module would report itself installed
 * while doing nothing. Specificity was worked out against theirs, not guessed:
 *   sx    #studioView.sx-grid #copilotCard                     (2,1,0)
 *   here  body.mls-sm:not(.mls-sm-ask) #studioView #copilotCard (2,2,1)  wins
 *   ax    #analysisView.ax-grid                                (1,1,0)
 *   here  body.mls-sm:not(.mls-sm-practice) #analysisView      (1,2,1)  wins
 *
 * ONE CELL, ONE PANEL (2026-07-29, owner screenshot: "Practice trends" and the
 * natural-language study builder painted on top of each other, text over text).
 * sx does not give every child its own cell — feat_mls_studio_exact.js:98 puts
 * #mlsSgPro, #mlsStudyRequest, #mls-sg-root and #mlsB39SgWrap all in row 3
 * spanning 1/-1, and this file put #analysisView there too. So membership in
 * SECTIONS is not a nicety: a #studioView child that belongs to no section is
 * never hidden, and an unhidden child of row 3 paints straight through
 * Practice. Two rules follow, and tests/studio-tabs-show-one-panel.test.js
 * pins both:
 *   1. every direct child sx explicitly places must belong to a section, and
 *   2. no two panels that can be visible together may share a cell — at any
 *      viewport width, including the stranded-switcher state below.
 *
 * SHOWING is left to ax where ax is present — its display:grid!important beats
 * showView's inline display:none, so there is no inline fight at all. The only
 * show rule here is for the case where ax did NOT install (its prod-enable
 * marker is a separate line): #analysisView:not(.ax-grid) then needs a display
 * of its own, or Practice would render blank with no error anywhere.
 *
 * ROUTING. showView('analysis') is wrapped, not replaced, and lands on the
 * merged surface with Practice selected. That is deliberately ONE redirect
 * rather than 15 edited call sites: the rail tab, the command palette,
 * feat_mls_copilot_actions, feat_mls_copilot_voice_v2, the custom-tool
 * navigate action and mls-connect's own Tools row all route through it and
 * therefore cannot drift.
 *
 * Escape hatch: ?ui=classic, or window.__mlsStudioMerge.revert().
 */
(function () {
  'use strict';

  if (window.__mlsStudioMerge) return;

  var VERSION = 'sm-1.0.0';
  var W = window, D = document;
  var BODY_CLASS = 'mls-sm';
  var STYLE_ID = 'mlsStudioMergeCss';
  var TABS_ID = 'mlsSmTabs';
  var STORE_KEY = 'mlsStudioSection';

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function byId(id) { return safe(function () { return D.getElementById(id); }); }
  function qs(sel, root) { return safe(function () { return (root || D).querySelector(sel); }); }
  function qsa(sel, root) {
    return safe(function () { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }) || [];
  }
  function visible(el) {
    if (!el) return false;
    var r = safe(function () { return el.getBoundingClientRect(); });
    if (!r || !(r.width > 0 && r.height > 0)) return false;
    var cs = safe(function () { return W.getComputedStyle(el); });
    return !!cs && cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function classic() {
    return safe(function () { return /(?:^|[?&])ui=classic(?:&|$)/.test(String(location.search || '')); }, false);
  }

  /* ------------------------------------------------------------- sections */

  /* Each section names the DIRECT CHILDREN of #studioView it owns. Membership
     is by selector so a rebuild that recreates a node keeps working; nothing
     is captured by reference. */
  var SECTIONS = [
    {
      key: 'ask',
      label: 'Ask',
      hint: 'Ask the Copilot about your practice',
      members: ['#studioView > #copilotCard'],
      /* The primary here is a PROMOTION, not an addition: the ask box already
         exists, and a big button whose only job is to focus a nearby textarea
         is one more button on the screen the owner says has too many. */
      focus: '#copilotInput'
    },
    {
      key: 'practice',
      label: 'Practice',
      hint: 'Your trends, outcomes and doctors',
      members: ['#studioView > #analysisView']
    },
    {
      key: 'build',
      label: 'Build',
      hint: 'Build a tool, or run a study',
      /* THE OVERLAP THE OWNER PHOTOGRAPHED (2026-07-29): "Practice trends" and
         the natural-language study builder painted on top of each other.
         sx places FOUR study hosts in one full-width cell —
           feat_mls_studio_exact.js:98
             #studioView.sx-grid>#mlsSgPro, >#mlsStudyRequest, >#mls-sg-root,
             >#mlsB39SgWrap { grid-column:1/-1!important; grid-row:3!important }
         — and css() below puts Practice's #analysisView in that SAME cell.
         Only #mlsB39SgWrap was ever named here, so #mlsSgPro (the host the
         natural-language study builder mounts into, feat_mls_study_request.js
         mount(): `pro.insertBefore(section, details)`) belonged to NO section,
         got NO hide rule, and stayed visible under every tab. Measured live at
         b788: #mlsSgPro and #analysisView both at x493 y291 w1320.
         Every host sx places is named now, so every one of them has a hide
         path — membership is by selector, so the three that are normally
         nested rather than direct children cost nothing until a rebuild
         promotes them (feat_mls_study_request revert() does exactly that to
         #mls-sg-root). */
      members: [
        '#studioView > #mlsSgPro',
        '#studioView > #mlsStudyRequest',
        '#studioView > #mls-sg-root',
        '#studioView > .sx-right',
        '#studioView > #studioResultCard',
        '#studioView > #mlsB39SgWrap'
      ],
      focus: '#studioPrompt'
    }
  ];
  var KEYS = SECTIONS.map(function (s) { return s.key; });

  function current() {
    var k = safe(function () { return D.body.getAttribute('data-mls-sm'); }) || '';
    return KEYS.indexOf(k) >= 0 ? k : '';
  }

  function remembered() {
    var k = safe(function () { return W.localStorage.getItem(STORE_KEY); }) || '';
    return KEYS.indexOf(k) >= 0 ? k : 'ask';
  }

  /* The stranded-switcher escape: every section open at once because the way
     back to them is not on screen. See reconcile(). */
  function allShown() {
    return safe(function () { return D.body.classList.contains(BODY_CLASS + '-all'); }, false);
  }

  /* ------------------------------------------------------------------ css */

  function css() {
    var out = [];
    SECTIONS.forEach(function (sec) {
      sec.members.forEach(function (sel) {
        /* !important and this exact specificity are load-bearing — see header.
           The extra :not(.mls-sm-all) is the stranded-switcher escape: one
           class now opens every section instead of setting all three section
           classes at once, which used to switch the full-width promotions on
           together and put two panels in one cell. Specificity rises from
           (2,2,1) to (2,3,1) — still above sx (2,1,0) and ax (1,1,0). */
        out.push('body.' + BODY_CLASS + ':not(.' + BODY_CLASS + '-all):not(.' + BODY_CLASS + '-' + sec.key + ') ' + sel + '{display:none!important}');
      });
    });
    return out.concat([
      /* EXPLICIT grid rows, because sx places its own children explicitly
         (title 1, Study Groups 3, copilot/build 4, pay 5, result 6) and an
         auto-placed item lands AFTER all of them. Measured: the switcher
         auto-placed to y=2163 in Practice — below the whole tile grid, which
         is the one place it must never be. */
      '#' + TABS_ID + '{grid-row:2}',
      /* Row 3 is Study Groups' row, and Study Groups is a BUILD member — the
         two are never visible together, and a display:none grid item is
         removed from the grid entirely rather than reserving its track. Any
         later row left a dead band between the switcher and the tiles:
         measured, rows 3-6 were empty and Practice opened with 300px of
         nothing under its own switcher. */
      'body.' + BODY_CLASS + ' #studioView > #analysisView{grid-column:1 / -1;grid-row:3;min-width:0}',

      /* ONE CELL, ONE PANEL — the other half of the 2026-07-29 overlap fix.
         Naming the study hosts as Build members stops them painting over
         Practice, but sx:98 stacks all FOUR of them on row 3, so on Build
         #mlsSgPro and #mlsB39SgWrap would still share one cell. Give each its
         own row, counting on from the result card (sx: row 6, or row 8 at
         <=980px) in the order mls-connect's own placeOrder() already wants —
         "result -> advanced SG", mls-connect.js placeOrder(). Consecutive
         rows, so no empty track is reserved; and the hosts that are normally
         nested cost nothing while hidden, because a display:none grid item is
         removed from the grid entirely.
         !important here is forced, not chosen: sx writes grid-row:3!important
         at (2,1,0), and only a MORE SPECIFIC !important rule can move it.
         body.mls-sm #studioView.sx-grid > #X is (2,2,1). Without .sx-grid the
         selector would be (2,1,1) — a one-element-token margin over sx, which
         is too thin a thing to rest a layout on. */
      'body.' + BODY_CLASS + ' #studioView.sx-grid > #mlsB39SgWrap{grid-row:7!important}',
      'body.' + BODY_CLASS + ' #studioView.sx-grid > #mls-sg-root{grid-row:8!important}',
      'body.' + BODY_CLASS + ' #studioView.sx-grid > #mlsStudyRequest{grid-row:9!important}',
      /* sx re-stacks itself below 980px (copilot 4, right 5, lock 6, pay 7,
         result 8), so the study hosts follow it down or they would land on the
         Pay Reports tile. "No overlap at any width" is the whole point. */
      '@media (max-width:980px){',
      '  body.' + BODY_CLASS + ' #studioView.sx-grid > #mlsB39SgWrap{grid-row:9!important}',
      '  body.' + BODY_CLASS + ' #studioView.sx-grid > #mls-sg-root{grid-row:10!important}',
      '  body.' + BODY_CLASS + ' #studioView.sx-grid > #mlsStudyRequest{grid-row:11!important}}',

      /* Only needed when ax did not install: without this Practice renders
         blank and nothing anywhere says why. */
      'body.' + BODY_CLASS + '.' + BODY_CLASS + '-practice #studioView > #analysisView:not(.ax-grid),',
      'body.' + BODY_CLASS + '.' + BODY_CLASS + '-all #studioView > #analysisView:not(.ax-grid){display:block!important}',
      /* When a section is alone on screen it takes the whole width. The
         two-column split existed because Copilot and Build shared the page;
         they no longer do. Both promotions stand down in the stranded-switcher
         state, where Ask and Build are on screen together: two full-width
         panels in sx's shared row 4 is the very overlap this file now tests
         against. */
      'body.' + BODY_CLASS + '.' + BODY_CLASS + '-ask:not(.' + BODY_CLASS + '-all) #studioView > #copilotCard{grid-column:1 / -1!important}',
      'body.' + BODY_CLASS + '.' + BODY_CLASS + '-build:not(.' + BODY_CLASS + '-all) #studioView > .sx-right{grid-column:1 / -1!important}',
      /* Practice's own row is explicit (above) and #mlsSgPro's is sx's row 3.
         With every section open at once those two are the last pair left in
         one cell, so Practice auto-places instead: grid auto-placement is
         collision-free by construction — it only ever uses a free cell. */
      'body.' + BODY_CLASS + '.' + BODY_CLASS + '-all #studioView > #analysisView{grid-row:auto!important}',

      /* ---- the switcher ---- */
      '#' + TABS_ID + '{grid-column:1 / -1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;',
      '  margin:0 0 4px;padding:5px;border:1px solid var(--line);border-radius:var(--r-pill,999px);',
      '  background:var(--soft);width:max-content;max-width:100%}',
      '#' + TABS_ID + ' .mls-sm-tab{appearance:none;border:0;background:transparent;color:var(--muted);',
      '  font:inherit;font-size:14px;font-weight:600;padding:8px 18px;border-radius:var(--r-pill,999px);',
      '  cursor:pointer;white-space:nowrap;',
      '  transition:background var(--mls-dur-2,200ms) var(--mls-ease-inout,ease),',
      '             color var(--mls-dur-2,200ms) var(--mls-ease-inout,ease),',
      '             transform var(--mls-dur-1,120ms) var(--mls-ease-out,ease)}',
      '#' + TABS_ID + ' .mls-sm-tab:hover{color:var(--ink)}',
      '#' + TABS_ID + ' .mls-sm-tab:active{transform:scale(.97)}',
      '#' + TABS_ID + ' .mls-sm-tab[aria-selected="true"]{background:var(--card);color:var(--ink);',
      '  box-shadow:var(--shadow-soft,0 1px 2px rgba(20,33,28,.05))}',
      '#' + TABS_ID + ' .mls-sm-tab:focus-visible{outline:2px solid var(--brand);outline-offset:2px}',
      '#' + TABS_ID + ' .mls-sm-hint{color:var(--muted);font-size:12.5px;font-weight:500;padding:0 12px 0 6px}',
      '@media (max-width:560px){#' + TABS_ID + '{width:100%;justify-content:stretch}',
      '  #' + TABS_ID + ' .mls-sm-tab{flex:1;padding:9px 8px;text-align:center}',
      '  #' + TABS_ID + ' .mls-sm-hint{display:none}}',
      '@media (prefers-reduced-motion:reduce){#' + TABS_ID + ' .mls-sm-tab{transition:none}',
      '  #' + TABS_ID + ' .mls-sm-tab:active{transform:none}}',

      /* ---- Build's own fold: the eleven-chip starter gallery ---- */
      'body.' + BODY_CLASS + ':not(.' + BODY_CLASS + '-starters) #studioView #studioTemplates{display:none!important}',
      '.mls-sm-more{display:inline-flex;align-items:center;gap:6px;margin:10px 0 0;padding:7px 14px;',
      '  border:1px solid var(--line);border-radius:var(--r-pill,999px);background:transparent;',
      '  color:var(--muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer;',
      '  transition:background var(--mls-dur-2,200ms) var(--mls-ease-inout,ease)}',
      '.mls-sm-more:hover{background:var(--soft)}',
      '@media (prefers-reduced-motion:reduce){.mls-sm-more{transition:none}}',

      /* Ask's primary is a PROMOTION, not an addition — carried over from
         cv-1.0.0 when AI Studio's ownership moved here. The next step on Ask
         is to ask a question and the control already exists; a big button
         whose only job is to focus the box below it would be one more button
         on the screen the owner is complaining about. */
      'body.' + BODY_CLASS + ' #studioView #copilotInput{min-height:62px!important;font-size:16.5px!important;padding:14px 16px!important;border-radius:var(--r-ctl,12px)!important}',
      'body.' + BODY_CLASS + ' #studioView #copilotSendBtn{min-width:56px;min-height:56px;font-size:19px;border-radius:var(--r-ctl,12px)!important}'
    ]).join('\n');
  }

  function installCss() {
    var s = byId(STYLE_ID);
    if (!s) {
      s = D.createElement('style');
      s.id = STYLE_ID;
      (D.head || D.documentElement).appendChild(s);
    }
    var want = css();
    if (s.textContent !== want) s.textContent = want;
  }

  /* -------------------------------------------------------------- mounting */

  /* Move #analysisView into #studioView, once. Its id-anchored ax selectors
     keep working; showView keeps finding it by id. */
  function hoistAnalysis() {
    var studio = byId('studioView'), analysis = byId('analysisView');
    if (!studio || !analysis) return false;
    if (analysis.parentElement === studio) return true;
    var tabs = byId(TABS_ID);
    var anchor = tabs && tabs.parentElement === studio ? tabs.nextSibling : null;
    if (anchor) studio.insertBefore(analysis, anchor);
    else studio.appendChild(analysis);
    return true;
  }

  function mountTabs() {
    var studio = byId('studioView');
    if (!studio) return;
    var bar = byId(TABS_ID);
    if (!bar) {
      bar = D.createElement('div');
      bar.id = TABS_ID;
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'AI Studio sections');
      SECTIONS.forEach(function (sec) {
        var b = D.createElement('button');
        b.type = 'button';
        b.className = 'mls-sm-tab';
        b.setAttribute('role', 'tab');
        b.setAttribute('data-mls-sm-tab', sec.key);
        b.textContent = sec.label;
        b.addEventListener('click', function () { select(sec.key, true); });
        b.addEventListener('keydown', onTabKey);
        bar.appendChild(b);
      });
      var hint = D.createElement('span');
      hint.className = 'mls-sm-hint';
      bar.appendChild(hint);
    }
    /* Directly after the title strip, so the switcher reads as part of the
       page header rather than as a floating control. */
    var title = qs('#studioView > .sx-title');
    var want = title ? title.nextSibling : studio.firstChild;
    if (bar.parentElement !== studio || bar.previousSibling !== (title || null)) {
      if (want) studio.insertBefore(bar, want); else studio.appendChild(bar);
    }
  }

  function onTabKey(ev) {
    var k = ev && ev.key;
    if (!/^(ArrowLeft|ArrowRight|Home|End)$/.test(k || '')) return;
    ev.preventDefault();
    var tabs = qsa('#' + TABS_ID + ' [data-mls-sm-tab]');
    var i = tabs.indexOf(ev.currentTarget);
    if (k === 'Home') i = 0;
    else if (k === 'End') i = tabs.length - 1;
    else i = (i + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    var t = tabs[i];
    if (t) { select(t.getAttribute('data-mls-sm-tab'), true); safe(function () { t.focus(); }); }
  }

  /* Build's starter gallery is eleven chips of secondary choice under a card
     whose primary is "Build it". Folded, with its route one click away in the
     same section — never a different one. */
  function mountStarters() {
    var host = qs('#studioView #studioTemplates');
    if (!host || !host.parentElement) return;
    var id = 'mlsSmStarters';
    var b = byId(id);
    var open = safe(function () { return D.body.classList.contains(BODY_CLASS + '-starters'); }, false);
    if (!b) {
      b = D.createElement('button');
      b.id = id;
      b.type = 'button';
      b.className = 'mls-sm-more';
      b.addEventListener('click', function () {
        var now = !safe(function () { return D.body.classList.contains(BODY_CLASS + '-starters'); }, false);
        safe(function () { D.body.classList.toggle(BODY_CLASS + '-starters', now); });
        mountStarters();
      });
    }
    var want = (open ? 'Hide' : 'Show') + ' starter tools';
    if (b.textContent !== want) b.textContent = want;
    if (b.getAttribute('aria-expanded') !== String(open)) b.setAttribute('aria-expanded', String(open));
    if (b.nextSibling !== host) host.parentElement.insertBefore(b, host);
  }

  /* ------------------------------------------------------------ selection */

  function select(key, remember) {
    if (KEYS.indexOf(key) < 0) key = 'ask';
    var body = D.body;
    if (!body) return;
    if (body.getAttribute('data-mls-sm') !== key) body.setAttribute('data-mls-sm', key);
    KEYS.forEach(function (k) {
      var on = k === key;
      if (body.classList.contains(BODY_CLASS + '-' + k) !== on) body.classList.toggle(BODY_CLASS + '-' + k, on);
    });
    qsa('#' + TABS_ID + ' [data-mls-sm-tab]').forEach(function (t) {
      var on = t.getAttribute('data-mls-sm-tab') === key;
      var sel = on ? 'true' : 'false', ti = on ? '0' : '-1';
      if (t.getAttribute('aria-selected') !== sel) t.setAttribute('aria-selected', sel);
      if (t.getAttribute('tabindex') !== ti) t.setAttribute('tabindex', ti);
    });
    var sec = SECTIONS.filter(function (s) { return s.key === key; })[0];
    var hint = qs('#' + TABS_ID + ' .mls-sm-hint');
    if (hint && sec && hint.textContent !== sec.hint) hint.textContent = sec.hint;
    if (remember) safe(function () { W.localStorage.setItem(STORE_KEY, key); });
    syncAnalysisInline(key);
    /* Give the section its own data a nudge — the Analysis tiles used to load
       on showView('analysis'), which no longer fires. */
    if (key === 'practice') refreshPractice();
  }

  /* THE INLINE display ON #analysisView IS LOAD-BEARING, and this is the
     defect that nearly shipped invisible.
     ax-3.0.0's render() begins:
         if (v.style.display === "none") { v.classList.remove(GRID_CLASS); return; }
     — it reads the INLINE display, not the computed one. showView() writes
     `analysisView.style.display='none'` on every navigation that is not
     'analysis', and after this merge that is EVERY navigation, because
     'analysis' is redirected to 'studio'. So ax refused to build: measured on
     the running page, #analysisView had class="" and 0 tiles, and Practice was
     rendering the raw stacked cards.
     Worse, it looked fine, because the `:not(.ax-grid)` safety rule in css()
     gave the raw cards a display and the section was not blank. A fallback
     that hides the failure it was written for is the most expensive kind.
     So this module owns that inline value: 'block' while Practice is the live
     section, 'none' otherwise. ax's own display:grid!important then wins the
     actual layout, and ax drops its grid class when Practice closes. */
  function syncAnalysisInline(key) {
    var an = byId('analysisView'), studio = byId('studioView');
    if (!an || !studio) return;
    /* The stranded-switcher state opens every section, and a section whose
       host is inline display:none is not open — ax would refuse to build and
       Practice would be the one section the rescue failed to rescue. */
    var open = key === 'practice' || allShown();
    var live = open && studio.style.display !== 'none';
    var want = live ? 'block' : 'none';
    if (an.style.display !== want) an.style.display = want;
    if (live) {
      safe(function () { if (W.__mlsAx && typeof W.__mlsAx.build === 'function') W.__mlsAx.build(); });
      safe(renamePracticeHeading);
    }
  }

  /* The section is called Practice. ax's own title says "Analysis". Two names
     for one thing on one screen is exactly what the labelling law forbids, and
     the switcher is the more prominent of the two — so the heading follows the
     switcher, not the other way round.
     Rewritten rather than hidden: a section with no heading reads as a stray
     grid, and ax's ensureTitle() only builds the title WHEN ABSENT, so the new
     text survives its re-renders. Idempotent, guarded by a read. */
  function renamePracticeHeading() {
    var h = qs('#studioView #analysisView > .ax-title h1');
    if (!h) return;
    if (h.textContent !== 'Practice trends') h.textContent = 'Practice trends';
  }

  var _practiceWarmed = false;
  function refreshPractice() {
    /* showView('analysis') used to run the loaders. It is now a redirect, so
       the loaders are called here instead — through the app's OWN functions,
       never a reimplementation, and only the ones that exist. */
    if (_practiceWarmed) return;
    _practiceWarmed = true;
    ['renderKeyTrends', 'loadAnalysisBaseline', 'loadOutcomesMarketing', 'renderAnalysisSummary']
      .forEach(function (fn) { safe(function () { if (typeof W[fn] === 'function') W[fn](); }); });
  }

  /* A later additive module can replace window.showView after our wrapper is
     installed. The old boolean then still says the hook is present, while an
     Analysis route reaches the shell unchanged: the shell hides Studio,
     #analysisView is already hoisted inside it, and the doctor sees a blank
     page. The canonical view event is emitted synchronously by the shell, so
     repair that one impossible post-merge state before the original call
     returns. Calling the ordinary Studio route preserves every outer wrapper;
     the guard makes the nested view event non-recursive. */
  var _repairingAnalysisRoute = false;
  function repairLostAnalysisRoute(event) {
    var view = safe(function () { return event && event.detail && event.detail.view; }, '') ||
      safe(function () { return W.__mlsCurrentView; }, '');
    if (view !== 'analysis' || _repairingAnalysisRoute || classic()) return;
    _repairingAnalysisRoute = true;
    try {
      if (typeof W.showView !== 'function') return;
      W.showView('studio');
      schedule();
      select('practice', true);
    } finally {
      _repairingAnalysisRoute = false;
    }
  }

  /* ---------------------------------------------------------- showView hook */

  function hookShowView() {
    if (W.__mlsSmShowViewHook) return;
    if (typeof W.showView !== 'function') return;
    W.__mlsSmShowViewHook = true;
    var orig = W.showView;
    W.showView = function (v) {
      if (v === 'analysis') {
        /* One redirect, not fifteen edited call sites. Everything that ever
           navigated to Analysis — the rail tab, the command palette, the
           Copilot's action router, voice, a custom tool's navigate action —
           lands on the merged surface with Practice open, and cannot drift. */
        var r = orig.call(this, 'studio');
        schedule();
        select('practice', true);
        return r;
      }
      var out = orig.apply(this, arguments);
      if (v === 'studio') { schedule(); select(current() || remembered(), false); }
      return out;
    };
    W.showView.__mlsSmOrig = orig;
  }

  /* ------------------------------------------------------------- reconcile */

  var observers = [];
  var pending = 0;

  function reconcile() {
    if (classic()) { teardown(); return; }
    var studio = byId('studioView');
    if (!studio) return;
    safe(function () { if (!D.body.classList.contains(BODY_CLASS)) D.body.classList.add(BODY_CLASS); });
    installCss();
    hoistAnalysis();
    mountTabs();
    mountStarters();
    /* THE SAME INVARIANT THE CALM VIEWS EARNED: a fold whose route back cannot
       be SEEN is a deleted feature. If the switcher is not rendering, show
       everything rather than leave two of three sections unreachable.
       ONE class, not all three section classes: the section classes also drive
       the full-width promotions, so setting them together used to put Ask's
       Copilot and Build's tools in sx's shared row 4 — a rescue that recreated
       the overlap it was rescuing from. .mls-sm-all opens every hide rule and
       nothing else, and it is REMOVED again the moment the switcher paints, so
       a transient first-frame measurement cannot strand the page in it. */
    var bar = byId(TABS_ID);
    var stranded = studio.style.display !== 'none' && !!bar && !visible(bar);
    safe(function () { D.body.classList.toggle(BODY_CLASS + '-all', stranded); });
    /* The escape must not LATCH. Measured live at b789: the switcher reports
       0x0 on its first paint, this ran once, and nothing re-evaluated it — so
       every tab showed every panel for the rest of the session. One bounded
       re-check (never more than one pending, and it only re-arms while the
       flag is actually set) keeps the header comment's promise that the class
       is removed the moment the switcher paints. */
    if (stranded && !_strandedRecheck) {
      _strandedRecheck = true;
      safe(function () {
        W.setTimeout(function () { _strandedRecheck = false; safe(reconcile); }, 400);
      });
    }
    if (stranded && !_warnedStranded) {
      _warnedStranded = true;
      safe(function () {
        if (W.console && W.console.warn) W.console.warn('[MLS studio merge] the section switcher is not visible; every section is shown rather than stranded.');
      });
    }
    if (!current()) select(remembered(), false);
    else syncAnalysisInline(current());
  }
  var _warnedStranded = false;
  var _strandedRecheck = false;

  function schedule() {
    if (pending) return;
    pending = (W.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      pending = 0;
      safe(reconcile);
    });
  }

  function watch() {
    var studio = byId('studioView');
    if (studio && W.MutationObserver) {
      var mo = new W.MutationObserver(function () {
        /* Only re-mount when this module's own furniture went missing, or when
           a rebuild moved #analysisView back out. sx and ax both re-render on
           their own observers; reconciling on every one of their mutations
           would make this module a churn source instead of a cure. */
        var needTabs = !byId(TABS_ID) || byId(TABS_ID).parentElement !== studio;
        var needHoist = byId('analysisView') && byId('analysisView').parentElement !== studio;
        if (needTabs || needHoist) schedule();
      });
      mo.observe(studio, { childList: true });
      observers.push(mo);
    }
    var nav = qs('.mainnav');
    if (nav && W.MutationObserver) {
      var mo2 = new W.MutationObserver(schedule);
      mo2.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
      observers.push(mo2);
    }
  }

  function teardown() {
    observers.forEach(function (o) { safe(function () { o.disconnect(); }); });
    observers = [];
    safe(function () { W.removeEventListener('mls:view-changed', repairLostAnalysisRoute, false); });
    safe(function () { D.body.classList.remove(BODY_CLASS); });
    KEYS.forEach(function (k) { safe(function () { D.body.classList.remove(BODY_CLASS + '-' + k); }); });
    safe(function () { D.body.classList.remove(BODY_CLASS + '-all'); });
    safe(function () { D.body.classList.remove(BODY_CLASS + '-starters'); });
    safe(function () { D.body.removeAttribute('data-mls-sm'); });
    var bar = byId(TABS_ID); if (bar) bar.remove();
    var st = byId('mlsSmStarters'); if (st) st.remove();
    var css = byId(STYLE_ID); if (css) css.remove();
    /* Put Analysis back where the shell expects it, so ?ui=classic is a real
       escape hatch and not a half-migrated page. */
    var analysis = byId('analysisView'), wrap = byId('appWrap');
    if (analysis && wrap && analysis.parentElement !== wrap) wrap.appendChild(analysis);
    if (W.showView && W.showView.__mlsSmOrig) { W.showView = W.showView.__mlsSmOrig; W.__mlsSmShowViewHook = false; }
  }

  function start() {
    if (classic()) return;
    safe(function () { W.addEventListener('mls:view-changed', repairLostAnalysisRoute, false); });
    hookShowView();
    reconcile();
    watch();
    /* Bounded timeout chain, never an interval: sx and ax mount on view open,
       and an interval that clears itself still registers as a poller. */
    var tries = 0;
    (function retry() {
      if (tries++ > 24) return;
      setTimeout(function () { hookShowView(); schedule(); retry(); }, 700);
    })();
  }

  window.__mlsStudioMerge = {
    version: VERSION,
    sections: KEYS,
    select: function (k) { schedule(); select(k, true); },
    current: current,
    reconcile: schedule,
    revert: function () { teardown(); delete window.__mlsStudioMerge; return 'reverted'; }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
