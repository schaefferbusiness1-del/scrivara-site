/* MLS Calm Views — cv-1.0.0
 *
 * REDESIGN_CONTRACT_2026-07-26.md, applied to the views the dock reaches that
 * are not Visit or Patients: Calendar, History, AI Studio, Analysis.
 *
 * Owner's brief, verbatim: "i LOVE THE NAVIGATER BUT I BASICALLY HATE HOW MANY
 * BUTTONS EVERY SINGLE UI ANYTHING HAS ... I WANT IT TO FREE DOCTORS FROM
 * BUTTONS AND JUST BE ABLE TO BE USED BY ANY DOCTOR WITH 1 MUINIT OF LEARNING".
 *
 * ARCHITECTURE — read this before changing anything.
 *
 * This module owns PRESENTATION ONLY, exactly like feat_mls_calm_shell.js, and
 * for the same reason: it must be impossible for it to drift out of sync with
 * the clinical logic.
 *
 *   - The primary action NEVER reimplements anything. It finds the control the
 *     app already ships and clicks it. Where the app exposes the entry point as
 *     a function and the button that calls it only exists in one state (the
 *     Calendar's pull lives inside the EMPTY-state card, so a loaded calendar
 *     has no pull control at all), the primary calls that same exported
 *     function — the identical call the button makes, named in the code.
 *   - If the real control and the real function are both absent, the primary is
 *     ABSENT. A screen never grows a button that cannot do anything.
 *   - Nothing is deleted. Everything folded is hidden by CLASS, under
 *     `body.mls-cv`, and every fold has a "More" disclosure IN THE SAME VIEW
 *     that reveals it in one click without navigating.
 *     tests/calm-views-folds-keep-reach.test.js enforces that.
 *   - No floating anything. The primary card is in normal flow, at the top of
 *     the view it belongs to. Fixed chrome remains the dock, full stop.
 *
 * WHY A DISCLOSURE AND NOT THE TOOLS MENU. The Calm Shell folds cross-screen
 * capabilities into Tools, which is right for capabilities. These are view-local
 * chrome: a date range, a refresh, a duplicate scrubber. A doctor looking for
 * the calendar's date range looks AT THE CALENDAR. Sending it to a global menu
 * would be a worse answer that happened to satisfy a reach test.
 *
 * CHURN. This module installs no interval. It observes the nav rail only for an
 * ACTUAL active-view change, and a mounted view only for the small pieces this
 * module owns. Unrelated class/list churn never queues a frame. Async-owner
 * retries compare a cheap concern snapshot first, so an unchanged screen does
 * not even enter reconcile. Every write inside a real reconcile is still
 * guarded by a read. (b640: 86 no-op body-class writes in 44s were a
 * whole-document recalc 1.4x/sec. classList.add/remove re-commit
 * unconditionally; toggle does not.)
 *
 * Escape hatch: window.__mlsCalmViews.revert(), or ?ui=classic (honoured below).
 */
(function () {
  'use strict';

  if (window.__mlsCalmViews) return;

  var VERSION = 'cv-1.0.0';
  var W = window, D = document;
  var BODY_CLASS = 'mls-cv';
  var STYLE_ID = 'mlsCalmViewsCss';

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function byId(id) { return safe(function () { return D.getElementById(id); }); }
  function qs(sel, root) { return safe(function () { return (root || D).querySelector(sel); }); }
  function qsa(sel, root) {
    return safe(function () { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }) || [];
  }
  /* Visible means "a person can see it": its own computed style AND a real rect.
     Never offsetParent — a view container that is display:none makes every
     descendant report offsetParent null, which would call every control absent. */
  function visible(el) {
    if (!el) return false;
    var r = safe(function () { return el.getBoundingClientRect(); });
    if (!r || !(r.width > 0 && r.height > 0)) return false;
    var cs = safe(function () { return W.getComputedStyle(el); });
    return !!cs && cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  /* The active nav tab already establishes which view is being opened. At that
     boundary we only need to reject an explicitly hidden root; a rect read
     would force layout before this module has finished its guarded inserts. */
  function styleVisible(el) {
    if (!el) return false;
    var cs = safe(function () { return W.getComputedStyle(el); });
    return !!cs && cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function classic() {
    return safe(function () { return /(?:^|[?&])ui=classic(?:&|$)/.test(String(location.search || '')); }, false);
  }

  /* ---------------------------------------------------------------- config */

  /* Each view declares:
       id       the view container id
       fold     selectors hidden under body.mls-cv, revealed by this view's More
       more     { label, anchor } where the disclosure mounts
       primary  { anchor, label(), sub, act() } — act() returns false when it
                could not run, which keeps the button honest rather than toasting
                a success nothing proved.
     A selector that matches nothing is simply inert; a view whose primary
     cannot resolve renders no primary. */
  var VIEWS = [
    {
      key: 'calendar',
      id: 'calendarView',
      /* The calendar showed TWO month grids (the left rail's mini and the agenda
         card's real one), a nine-control range/procedure planner, a four-control
         chrome cluster, and a colour legend — 58 visible controls, of which 33
         were the duplicate mini-month's day cells. The agenda grid IS the
         calendar; the rest is planning apparatus for a power user. */
      fold: [
        '#calendarView .cx-card.cx-mini',   /* the second month grid */
        '#calendarView #cpRow',             /* range + weekday-procedure + pull-plan strip */
        '#calendarView .cx-rightctrls',     /* refresh / working hours / jump / remove duplicates */
        '#calendarView .cx-cta-slot',       /* + New appointment: the day panel offers it in context */
        '#calendarView .t3r-rf'             /* the provider roster's own refresh */
      ],
      more: { label: 'More calendar tools', anchor: '#calendarView .cx-agenda-head, #calendarView .card' },
      primary: {
        anchor: '#calendarView .card.cx-agenda, #calendarView .card',
        /* On a phone the agenda card is the THIRD thing down — the patient
           card and the left rail come first — so the primary was below the
           fold at 390x844 and the biggest thing on the first screen was "DAY
           AT A GLANCE". Measured on a running page, not assumed. Narrow
           viewports mount it at the top of the view instead. */
        anchorNarrow: '#calendarView',
        label: function () {
          var d = calRefDate();
          return d ? ('Pull ' + d.label) : 'Pull this day’s schedule';
        },
        sub: 'Reads that day’s appointments from athenaOne. Nothing is written.',
        available: function () {
          return !!(qs('#mlsT3Empty .t3e-pull') || typeof W.pullScheduleViaAssist === 'function');
        },
        act: function () {
          /* lr-1.0 (label/dispatch honesty, diagnosis 2026-08-11): this hero's
             label NAMES the selected day (calRefDate above) but both dispatch
             branches sent TODAY - proven live, Pull Tuesday Jul 7 pulled
             2026-08-11. A valid selected day now goes through
             pullScheduleViaAssist's explicit-date door (lr-1.0, ScribeFlow).
             The #mlsT3Empty .t3e-pull click and the bare call both dispatch
             TODAY (frontsync:507), so they serve only the no-label case, where
             the hero reads Pull this day\u2019s schedule and today is the truth. */
          var selDay = safe(function () { var r = String(W._calRefDate || ''); return /^\d{4}-\d{2}-\d{2}$/.test(r) ? r : ''; }, '');
          if (selDay && typeof W.pullScheduleViaAssist === 'function') { W.pullScheduleViaAssist(null, { date: selDay }); return true; }
          var btn = qs('#mlsT3Empty .t3e-pull');
          if (btn && visible(btn)) { btn.click(); return true; }
          if (typeof W.pullScheduleViaAssist === 'function') { W.pullScheduleViaAssist(); return true; }
          return false;
        }
      }
    },
    {
      key: 'history',
      id: 'historyView',
      /* History's <h2> was itself a five-button toolbar. The doctor's question
         here is "show me this patient's past visits" — so the search is the
         work, and the five actions are things you do AFTER you found one. */
      fold: [
        '#historyView .mls-cv-h2tools'      /* filled at mount: the buttons living inside the heading */
      ],
      more: { label: 'More history tools', anchor: '#historyView .card' },
      primary: {
        anchor: '#historyView .card',
        /* Empty history is the only state with a next step: get the chart. With
           visits on screen the list IS the answer and a competing hero would
           break law 3, so the primary stands down. */
        label: function () { return 'Pull chart from Athena'; },
        sub: 'Brings this patient’s name, date of birth and every prior visit into MLS.',
        available: function () {
          var btn = byId('pullChartBtn');
          return !!btn && !historyHasVisits();
        },
        act: function () { var b = byId('pullChartBtn'); if (!b) return false; b.click(); return true; }
      }
    },
    /* studioView IS NO LONGER LISTED HERE, and the reason is one owner per
       surface — the lesson this repo keeps re-learning.
       Owner, 2026-07-26: "add the analysis tab to the ai studio tab smartly".
       AI Studio is now three sections (Ask / Practice / Build) owned by
       feat_mls_studio_merge.js, which hoists #analysisView into it. This
       module's studio fold hid #studioTemplates and mounted its disclosure in
       "#studioView .card" — which after the merge resolves to #copilotCard,
       in the ASK section, while the thing it folds lives in BUILD. A route
       back that is in a different section is not a route back. The fold and
       its disclosure moved into the merge module's Build section, where they
       are one click from what they hide.
       Nothing about the ask box's promotion is lost: sm-1.0.0 carries it. */
    {
      key: 'team',
      id: 'teamView',
      /* Team's <h2> was a four-button toolbar and its empty state said "Press
         Refresh to load your team" — an instruction that points at a button by
         name, which stops being true the moment that button moves or folds.
         The empty state now IS the primary action. */
      fold: ['#teamView .mls-cv-h2tools'],   /* marked at mount */
      more: { label: 'More team tools', anchor: '#teamView .card' },
      primary: {
        anchor: '#teamView .card',
        label: function () { return teamHasList() ? 'Refresh your team' : 'Load your team'; },
        sub: 'Read-only. Every chart still belongs to the doctor who owns it.',
        available: function () { return typeof W.loadTeamPatients === 'function'; },
        act: function () {
          if (typeof W.loadTeamPatients !== 'function') return false;
          W.loadTeamPatients();
          return true;
        }
      }
    },
    /* analysisView IS NOT LISTED, and the reason is worth keeping.
       It was, with one fold (#t7AxRefresh) and a disclosure anchored at
       "#analysisView .card". Measured on a running page: the disclosure had
       rect 0x0 and all nine sample points across it belonged to #appHeader.
       #analysisView computes to display:grid — feat_mls_analysis_exact.js
       rebuilds the view and the static #anaKeyTrends card that the anchor
       matched is no longer the rendered surface. So the fold worked (15 -> 14
       controls) and its route back did not exist: a hidden feature with no way
       to it, which is the exact failure the reach contract exists to prevent.
       Analysis was already the calmest of these screens — twelve of its
       fifteen controls ARE the content. Folding one refresh was never worth a
       stranded control, so it is left alone until the view itself is rebuilt.
       The invariant this taught (a fold whose disclosure is not VISIBLE
       unfolds itself) is enforced below for every view that is listed. */
  ];

  /* ------------------------------------------------------------- utilities */

  function calRefDate() {
    return safe(function () {
      var raw = W._calRefDate;
      if (!raw) return null;
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
      if (!m) return null;
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (isNaN(d.getTime())) return null;
      var DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return { label: DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate() };
    }, null);
  }

  function teamHasList() {
    return safe(function () {
      var host = byId('teamList');
      return !!host && qsa('*', host).some(visible);
    }, false);
  }

  function historyHasVisits() {
    /* Judge from the rendered list, never from a store read — the store and the
       screen have disagreed before, and the screen is what the doctor sees. */
    return safe(function () {
      var host = byId('histList') || qs('#historyView [id*="hist" i][id*="list" i]');
      if (!host) return false;
      return qsa('.visit-row,.hist-row,li,tr', host).some(visible);
    }, false);
  }

  /* Mark a set of elements with a fold class so one CSS rule can hide them all.
     Marking (rather than listing every id) is what lets this survive the
     re-renders those views perform on every open. */
  function mark(els, cls) {
    els.forEach(function (el) {
      if (el && el.classList && !el.classList.contains(cls)) el.classList.add(cls);
    });
  }

  /* ------------------------------------------------------------------- css */

  function css() {
    var hide = [];
    VIEWS.forEach(function (v) {
      v.fold.forEach(function (sel) {
        /* !important, deliberately. Most of what this folds is built at runtime
           by the calendar/studio modules with INLINE styles (display:flex on
           #cpRow, display:grid on the gallery). An inline declaration beats any
           stylesheet rule regardless of selector specificity, so the first
           version of this file hid exactly the two folds that happened to have
           no inline display and silently left the other three on screen — while
           the module reported itself installed. Measured, not assumed:
           calendar was still 25 controls with the fold "applied". */
        hide.push('body.' + BODY_CLASS + ':not(.mls-cv-open-' + v.key + ') ' + sel + '{display:none!important}');
      });
    });
    return hide.join('\n') + '\n' + [
      /* The primary is the one big obvious thing. Sized from the visit hero
         (#ez3Nxt) so a doctor who learned that button has learned this one. */
      '.mls-cv-primary{display:block;width:100%;box-sizing:border-box;margin:0 0 14px;padding:16px 20px;border:0;',
      '  border-radius:16px;background:#2E6A4B;color:#fff;text-align:left;cursor:pointer;font:inherit}',
      /* Motion comes from the shell's shared vocabulary (--mls-dur-* /
         --mls-ease-*, feat_mls_calm_shell.js "mls-motion-system"), never a
         curve invented here. Transform and opacity ONLY: anything else costs a
         reflow, and boot's TBT on this app is already dominated by forced
         layout. Background is a paint, not a layout, and matches the shell's
         own control-hover rule. */
      '.mls-cv-primary,.mls-cv-more{transition:background var(--mls-dur-2,200ms) var(--mls-ease-inout,ease),',
      '  transform var(--mls-dur-1,120ms) var(--mls-ease-out,ease)}',
      '.mls-cv-primary:hover{background:#25573D}',
      '.mls-cv-primary:active,.mls-cv-more:active{transform:scale(.985)}',
      '@media (prefers-reduced-motion:reduce){.mls-cv-primary,.mls-cv-more{transition:none}',
      '  .mls-cv-primary:active,.mls-cv-more:active{transform:none}}',
      '.mls-cv-primary .mls-cv-big{display:block;font-size:19px;font-weight:800;line-height:1.25}',
      '.mls-cv-primary .mls-cv-sub{display:block;margin-top:4px;font-size:13px;font-weight:500;opacity:.92}',
      '.mls-cv-more{display:inline-flex;align-items:center;gap:6px;margin:0 0 12px;padding:7px 14px;',
      '  border:1px solid #D9D6CD;border-radius:999px;background:transparent;color:#41606d;',
      '  font:inherit;font-size:13px;font-weight:600;cursor:pointer}',
      '.mls-cv-more:hover{background:#F1F5F2}',
      /* THE TOAST WAS EATING DOCK CLICKS WHILE INVISIBLE, which is the more
         interesting half of this rule.
         `.toast` is `display:block` at all times; hiding it is `opacity:0`
         plus `transform:translateY(80px)`. That transform parks the empty
         46x28 element at y 735..763 — inside the dock's 697..782 — and
         opacity has no effect on hit-testing, so an element nobody can see
         was intercepting clicks aimed at "AI Studio" and "Tools". A census
         that filters on opacity:0 (mine did, at first) reports it as absent.
         A toast has no interactive content, so pointer-events:none is
         strictly correct and covers the shown state too.
         The lift is the visual half: `.toast{bottom:96px}` and
         `body.mls-calm{padding-bottom:96px}` agree with each other and both
         disagree with the dock, which is 85px tall at bottom:18px and so
         occupies 18..103px. It is MEASURED from the dock (see liftToast)
         rather than guessed, so it stays right if the dock changes height. */
      /* b753: bottom:auto, NOT a lift. Measured live on b751: this rule (specificity
         0,2,1, later document order) beat the b748 top-anchor rule .toast{bottom:auto}
         (0,1,0), so the shown toast carried BOTH top:158px and bottom:100px and
         stretched to offsetHeight 1085 - an 87x1085 dark column down the whole
         viewport instead of a compact pill. The lift existed to raise a
         BOTTOM-anchored toast above the ask bar; the toast is top-anchored now, so
         the lift is not just redundant, it is the bug. */
      'body.' + BODY_CLASS + ' .toast{bottom:auto;pointer-events:none}',
      /* the continuity strip: the banner patient's presence on the calendar.
         Theme tokens throughout so dark mode carries it without the parity
         engine's help, and the motion tokens so its arrival feels intended. */
      '#mlsCvPtStrip{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:11px 16px;',
      '  background:var(--card,#fff);border:1px solid var(--line,#E7E5DD);border-radius:16px;',
      '  transition:opacity var(--mls-dur-2,200ms) var(--mls-ease-out,ease)}',
      '#mlsCvPtStrip .cvpt-name{font-weight:800;font-size:14.5px;color:var(--ink,#1A211C)}',
      '#mlsCvPtStrip .cvpt-sub{font-size:13px;color:var(--muted,#5a6b62)}',
      '#mlsCvPtStrip .cvpt-jump{margin-left:auto;padding:7px 14px;border:1px solid var(--line,#D9D6CD);border-radius:999px;',
      '  background:transparent;color:var(--brand-dk,#2E6A4B);font:inherit;font-size:13px;font-weight:700;cursor:pointer}',
      '#mlsCvPtStrip .cvpt-jump:hover{border-color:var(--brand,#2E6A4B)}',
      '@media (max-width:560px){.mls-cv-primary{padding:14px 16px}.mls-cv-primary .mls-cv-big{font-size:17px}}'
    ].join('\n');
  }

  function installCss() {
    if (byId(STYLE_ID)) return;
    var s = D.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css();
    (D.head || D.documentElement).appendChild(s);
  }

  /* --------------------------------------------------------------- mounting */

  /* Views whose fold targets do not exist in the markup get them MARKED here,
     once the view has rendered. Each returns the elements it marked so an empty
     result is visible to the reach test's runtime companion. */
  function markFolds(v) {
    if (v.key === 'history') {
      var h2 = qs('#historyView h2');
      if (h2) mark(qsa('button', h2), 'mls-cv-h2tools');
    }
    if (v.key === 'team') {
      var th2 = qs('#teamView h2');
      if (th2) mark(qsa('button', th2), 'mls-cv-h2tools');
      /* "Press Refresh to load your team" names a control by its label, and a
         label is the least stable thing on a screen — the moment Refresh folds
         into More, the sentence points nowhere. The empty state's job is one
         sentence; the primary above it is the action. */
      var empty = byId('teamEmpty');
      if (empty && empty.getAttribute('data-mls-cv-empty') !== '1') {
        empty.setAttribute('data-mls-cv-empty', '1');
        empty.innerHTML = '<span class="big">👥</span>Your team\'s charts are not loaded yet.';
      }
    }
  }

  function foldCount(v) {
    /* A disclosure only needs to know whether at least one fold exists. The
       old pass enumerated every match for all five Calendar selectors even
       though every caller reduced the result back to boolean. */
    for (var i = 0; i < v.fold.length; i++) {
      if (qs(v.fold[i])) return 1;
    }
    return 0;
  }

  function mountMore(v, verifyNow, verifyRequested) {
    var host = qs(v.more.anchor);
    if (!host) return { count: 0, host: null, el: null };
    var id = 'mlsCvMore_' + v.key;
    var existing = byId(id);
    /* Nothing folded on this screen right now -> no disclosure. An empty "More"
       is exactly the kind of button this module exists to remove. */
    var count = foldCount(v);
    if (!count) {
      if (existing) existing.remove();
      return { count: 0, host: host, el: null };
    }
    var b = existing || D.createElement('button');
    var changed = !existing;
    if (b.id !== id) { b.id = id; changed = true; }
    if (b.type !== 'button') { b.type = 'button'; changed = true; }
    if (b.className !== 'mls-cv-more') { b.className = 'mls-cv-more'; changed = true; }
    var open = isOpen(v);
    var want = (open ? 'Hide' : 'Show') + ' ' + v.more.label.replace(/^More /, 'more ');
    if (b.getAttribute('aria-expanded') !== String(open)) { b.setAttribute('aria-expanded', String(open)); changed = true; }
    if (b.textContent !== want) { b.textContent = want; changed = true; }
    b.onclick = function () { toggleOpen(v); };
    /* Never above the primary. When both land in the same card the disclosure
       must sit UNDER the one big obvious thing, or the screen has two things
       competing for first read — which is the defect, not the fix.
       Every branch here is guarded by a read: a reconcile of an unchanged
       screen must perform no DOM write at all. */
    var nxt = byId('mlsCvNxt_' + v.key);
    if (nxt && nxt.parentElement === host) {
      if (nxt.nextSibling !== b) { host.insertBefore(b, nxt.nextSibling); changed = true; }
    } else if (host.firstChild !== b) {
      host.insertBefore(b, host.firstChild);
      changed = true;
    }

    /* THE INVARIANT: a fold whose route back cannot be SEEN unfolds itself.
       Learned by measurement, not by reasoning. The analysis view's disclosure
       mounted into a card that its own rebuild module had replaced: the button
       existed, was in the DOM, had an onclick, and had rect 0x0 — so the fold
       hid a control and left no way to it. Every check that asserts "the
       disclosure exists" passes on that. Assert that it RENDERS. Route mounts
       perform this rect read in the following frame, after their guarded DOM
       writes have settled, so the interaction frame never forces layout. */
    if (verifyNow) {
      var shown = visible(b);
      if (!shown && !isOpen(v)) {
        autoOpened[v.key] = true;
        safe(function () { D.body.classList.add('mls-cv-open-' + v.key); });
        safe(function () {
        if (W.console && W.console.warn) {
          W.console.warn('[MLS calm views] ' + v.key + ': the More disclosure is not visible, so nothing is folded on this screen. Its anchor (' + v.more.anchor + ') no longer resolves to a rendered node.');
        }
        });
      } else if (shown && autoOpened[v.key]) {
      /* AND IT MUST BE REVERSIBLE, which the first version was not.
         Measured: a census that resized to 390x844 and back left AI Studio
         permanently unfolded — 33 controls where the fold had measured 17 —
         because the disclosure was briefly unrendered at the narrow width and
         the one-way guard latched open forever. A safety valve that cannot
         re-close is a defect wearing a safety valve's clothes. Only an
         AUTO-open is withdrawn; a doctor who pressed the button keeps it. */
        autoOpened[v.key] = false;
        safe(function () { D.body.classList.remove('mls-cv-open-' + v.key); });
      }
    } else if (verifyRequested || changed) {
      /* A rect read immediately after the insertions above forces layout inside
         this interaction frame. Let the browser finish it, then verify the
         rendered route in the next frame. A timer keeps the occluded-tab
         guarantee intact. */
      scheduleMoreVerification(v);
    }
    return { count: count, host: host, el: b };
  }

  /* Which views this module opened ITSELF (because their disclosure was not
     rendered), as opposed to opened by the doctor. Only the former is
     withdrawn automatically. */
  var autoOpened = Object.create(null);

  function isOpen(v) {
    return safe(function () { return D.body.classList.contains('mls-cv-open-' + v.key); }, false);
  }
  function toggleOpen(v) {
    var open = !isOpen(v);
    autoOpened[v.key] = false;   /* an explicit press is the doctor's, not ours */
    safe(function () { D.body.classList.toggle('mls-cv-open-' + v.key, open); });
    var b = byId('mlsCvMore_' + v.key);
    if (b) {
      b.setAttribute('aria-expanded', String(open));
      var want = (open ? 'Hide' : 'Show') + ' ' + v.more.label.replace(/^More /, 'more ');
      if (b.textContent !== want) b.textContent = want;
    }
  }

  function mountPrimary(v) {
    if (!v.primary) return { available: false, host: null, el: null };
    var id = 'mlsCvNxt_' + v.key;
    var el = byId(id);
    var ok = safe(function () { return v.primary.available(); }, false);
    if (!ok) {
      if (el) el.remove();
      return { available: false, host: null, el: null };
    }
    var narrow = safe(function () { return W.innerWidth <= 760; }, false);
    var host = (narrow && v.primary.anchorNarrow && qs(v.primary.anchorNarrow)) || qs(v.primary.anchor);
    if (!host) return { available: true, host: null, el: el };
    var label = safe(function () { return String(v.primary.label() || ''); }, '');
    if (!label) {
      if (el) el.remove();
      return { available: true, host: host, el: null };
    }
    if (!el) {
      el = D.createElement('button');
      el.id = id;
      el.type = 'button';
      el.className = 'mls-cv-primary';
      el.innerHTML = '<span class="mls-cv-big"></span><span class="mls-cv-sub"></span>';
      el.onclick = function () {
        /* Assert nothing. The action either runs the app's own control or it
           does not, and "it did not" is the message when it did not. */
        var ran = safe(function () { return v.primary.act(); }, false);
        if (!ran && typeof W.toast === 'function') {
          W.toast('That action is not available on this screen right now.', 'err');
        }
      };
    }
    var big = el.querySelector('.mls-cv-big'), sub = el.querySelector('.mls-cv-sub');
    if (big && big.textContent !== label) big.textContent = label;
    var subText = String(v.primary.sub || '');
    if (sub && sub.textContent !== subText) sub.textContent = subText;
    if (el.parentElement !== host || host.firstChild !== el) host.insertBefore(el, host.firstChild);
    return { available: true, host: host, el: el };
  }

  /* ------------------------------------------------------------- reconcile */

  var observers = [];
  var pending = 0;
  var scheduleSeq = 0;
  var dirtyViews = Object.create(null);
  var viewStates = Object.create(null);
  var moreVerifySeq = 0;
  var moreVerifyPending = Object.create(null);
  var lastActiveKey = '';
  var stopped = false;

  var viewByKey = Object.create(null);
  VIEWS.forEach(function (v) { viewByKey[v.key] = v; });

  function activeViewKey() {
    var on = qs('.mainnav .navtab.on');
    if (!on) return '';
    var id = String(on.id || '');
    var m = /^nav_(.+)$/.exec(id);
    return m ? m[1] : '';
  }

  function connected(el) {
    if (!el) return false;
    return safe(function () {
      if (typeof el.isConnected === 'boolean') return el.isConnected;
      return !!D.documentElement && D.documentElement.contains(el);
    }, false);
  }

  function primaryOwnerToken(v) {
    if (v.key === 'calendar') {
      return String(!!qs('#mlsT3Empty .t3e-pull')) + '|' + String(typeof W.pullScheduleViaAssist === 'function');
    }
    if (v.key === 'history') return String(!!byId('pullChartBtn'));
    if (v.key === 'team') return String(typeof W.loadTeamPatients === 'function');
    return '';
  }

  function activePatientToken() {
    var p = null;
    try { p = (typeof W.verifiedActivePatient === 'function' && W.verifiedActivePatient()) || null; } catch (e) {}
    if (!p) { try { p = (typeof W.activePatient === 'function' && W.activePatient()) || null; } catch (e2) {} }
    if (!p || p.id == null) return '';
    return String(p.id) + '|' + String(p.name || '') + '|' +
      String(p.athena_patient_id || p.external_id || p.patient_external_id || '');
  }

  function captureCalendarInputs(st) {
    var rows = Array.isArray(W._calAppts) ? W._calAppts : [];
    st.calRows = rows;
    st.calRowsLength = rows.length;
    st.calPatient = activePatientToken();
    st.calRefDate = String(W._calRefDate || '');
  }

  function calendarInputsChanged(st) {
    if (!st) return true;
    var rows = Array.isArray(W._calAppts) ? W._calAppts : [];
    return st.calRows !== rows || st.calRowsLength !== rows.length ||
      st.calPatient !== activePatientToken() || st.calRefDate !== String(W._calRefDate || '');
  }

  function rememberView(v, root, primaryInfo, moreInfo) {
    var st = viewStates[v.key] || (viewStates[v.key] = {});
    st.root = root;
    st.ready = true;
    st.primaryAvailable = !!(primaryInfo && primaryInfo.available);
    st.primaryHost = primaryInfo && primaryInfo.host;
    st.primaryEl = primaryInfo && primaryInfo.el;
    st.primaryOwner = primaryOwnerToken(v);
    st.moreCount = moreInfo ? moreInfo.count : 0;
    st.moreHost = moreInfo && moreInfo.host;
    st.moreEl = moreInfo && moreInfo.el;
    if (v.key === 'calendar') captureCalendarInputs(st);
  }

  /* A retry is allowed to queue a frame only when an input that can change our
     output changed. In particular, the 20 bounded async-owner checks below are
     cheap no-ops after a view is settled; they no longer run layout-sensitive
     fold/visibility work every 700ms. */
  function viewNeedsReconcile(v) {
    if (!v) return false;
    var root = byId(v.id);
    var st = viewStates[v.key];
    if (!st || st.root !== root || !st.ready) return true;
    if (!D.body.classList.contains(BODY_CLASS) || !byId(STYLE_ID)) return true;
    if (st.primaryOwner !== primaryOwnerToken(v)) return true;
    if (st.primaryAvailable && st.primaryHost && !connected(st.primaryEl)) return true;
    if (st.primaryAvailable && !st.primaryHost) {
      var narrow = safe(function () { return W.innerWidth <= 760; }, false);
      var primaryHost = (narrow && v.primary.anchorNarrow && qs(v.primary.anchorNarrow)) || qs(v.primary.anchor);
      if (primaryHost) return true;
    }
    if (!st.primaryAvailable && connected(byId('mlsCvNxt_' + v.key))) return true;
    if (st.moreCount > 0 && st.moreHost && !connected(st.moreEl)) return true;
    if (st.moreCount === 0 && connected(byId('mlsCvMore_' + v.key))) return true;
    if (v.key === 'calendar' && calendarInputsChanged(st)) return true;
    return false;
  }

  function nodeTouches(node, selector) {
    if (!node) return false;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    return safe(function () {
      return (typeof el.matches === 'function' && el.matches(selector)) ||
        (typeof el.closest === 'function' && !!el.closest(selector)) ||
        !!qs(selector, el);
    }, false);
  }

  function recordsTouch(records, selector) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (nodeTouches(r.target, selector)) return true;
      var groups = [r.addedNodes || [], r.removedNodes || []];
      for (var g = 0; g < groups.length; g++) {
        for (var n = 0; n < groups[g].length; n++) {
          if (nodeTouches(groups[g][n], selector)) return true;
        }
      }
    }
    return false;
  }

  function recordsAddFold(v, records) {
    var st = viewStates[v.key];
    if (st && st.moreCount > 0) return false;
    for (var i = 0; i < v.fold.length; i++) {
      if (recordsTouch(records, v.fold[i])) return true;
    }
    return false;
  }

  function mutationsConcernView(v, records) {
    if (!v || activeViewKey() !== v.key) return false;
    if (viewNeedsReconcile(v) || recordsAddFold(v, records)) return true;
    var st = viewStates[v.key];
    if ((!st || !connected(st.moreHost)) && recordsTouch(records, v.more.anchor)) return true;
    if ((!st || (st.primaryAvailable && !connected(st.primaryHost))) && v.primary) {
      var anchors = v.primary.anchor + (v.primary.anchorNarrow ? (', ' + v.primary.anchorNarrow) : '');
      if (recordsTouch(records, anchors)) return true;
    }
    if (v.key === 'history') {
      return recordsTouch(records, '#histList, #historyView h2, #pullChartBtn');
    }
    if (v.key === 'team') {
      return recordsTouch(records, '#teamList, #teamView h2');
    }
    /* Calendar grid churn matters only when its actual inputs changed. The
       fold selectors are CSS-scoped and survive a grid rebuild without a DOM
       pass; calendarInputsChanged covers date, patient and appointment data. */
    return v.key === 'calendar' && calendarInputsChanged(viewStates.calendar);
  }

  /* Lift the toast clear of the dock. Read the dock's real rect; write only on
     change (a no-op write of a custom property still invalidates style for the
     whole document — b640). Called on install and on resize, never on a timer. */
  function liftToast() {
    var dock = byId('mlsDock');
    if (!dock) return;
    var r = safe(function () { return dock.getBoundingClientRect(); });
    if (!r || !(r.height > 0)) return;
    var lift = Math.round(W.innerHeight - r.top + 14);   /* dock top, plus a gap */
    if (!(lift > 0) || lift > 400) return;               /* nonsense reading: leave the default */
    var want = lift + 'px';
    var root = D.documentElement;
    if (safe(function () { return root.style.getPropertyValue('--mls-toast-lift'); }) !== want) {
      safe(function () { root.style.setProperty('--mls-toast-lift', want); });
    }
  }

  /* Owner continuity law (2026-07-26): "PATIENT TO CALENDAR TO VISIT should
     all be on top banner patient." The calendar was the missing leg — it knew
     the day and the providers but nothing on it followed the doctor's chosen
     patient (measured live: banner "Bernard P Brooks", zero patient-scoped
     affordances). This strip is that leg: the active patient's name, their
     next appointment out of the SAME _calAppts the grid renders, and one Jump
     that drives the calendar's own navigation (calJump + calOpenDay — never a
     re-implementation). Write-only-on-change; removed when no patient is
     active; class-styled through the theme tokens so both themes carry it. */
  function calStripSig() {
    var p = null;
    try { p = (typeof W.verifiedActivePatient === 'function' && W.verifiedActivePatient()) || null; } catch (e) {}
    if (!p) { try { p = (typeof W.activePatient === 'function' && W.activePatient()) || null; } catch (e) {} }
    if (!p || p.id == null || !p.name) return null;
    var appts = Array.isArray(W._calAppts) ? W._calAppts : [];
    var extId = String(p.athena_patient_id || p.external_id || p.patient_external_id || '');
    var nm = String(p.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var todayKey = safe(function () { return typeof W._acctTodayKey === 'function' ? W._acctTodayKey() : ''; }) || '';
    var next = null, count = 0;
    appts.forEach(function (a) {
      if (!a) return;
      var match = extId && String(a.patient_external_id || '') === extId;
      if (!match) {
        var an = String(a.name || a.patient || '').trim().toLowerCase().replace(/\s+/g, ' ');
        match = !!nm && an === nm;
      }
      if (!match) return;
      count++;
      var d = String(a.appt_date || a.date || '').slice(0, 10);
      if (!d || (todayKey && d < todayKey)) return;
      if (!next || d < next) next = d;
    });
    return { name: p.name, count: count, next: next, sig: String(p.id) + '|' + (next || '-') + '|' + count };
  }
  function ensureCalStrip(rootKnownVisible) {
    var root = byId('calendarView');
    if (!root || (!rootKnownVisible && !visible(root))) return;
    var st = calStripSig();
    var el = byId('mlsCvPtStrip');
    if (!st) { if (el && el.parentNode) safe(function () { el.parentNode.removeChild(el); }); return; }
    if (el && el.getAttribute('data-sig') === st.sig) return;
    if (!el) {
      el = D.createElement('div');
      el.id = 'mlsCvPtStrip';
      var host = qs('#calendarView .card.cx-agenda, #calendarView .card') || root;
      safe(function () { host.parentNode ? host.parentNode.insertBefore(el, host) : root.insertBefore(el, root.firstChild); });
    }
    var label = st.next
      ? ('Next appointment ' + st.next + (st.count > 1 ? (' · ' + st.count + ' on the calendar') : ''))
      : (st.count ? (st.count + ' past appointment' + (st.count === 1 ? '' : 's') + ' · none upcoming') : 'No appointments on this calendar');
    el.setAttribute('data-sig', st.sig);
    el.innerHTML = '<span class="cvpt-name">' + escHtml(st.name) + '</span>' +
      '<span class="cvpt-sub">' + escHtml(label) + '</span>' +
      (st.next ? '<button type="button" class="cvpt-jump" id="mlsCvPtJump">Jump to it</button>' : '');
    var jb = byId('mlsCvPtJump');
    if (jb) jb.onclick = function () {
      var d = st.next; if (!d) return;
      /* Set the calendar's own reference date FIRST. calJump's renderCalendar
         re-opens _calRefDate when the calendar is in day mode, and that
         deferred re-open lands AFTER a synchronous calOpenDay — measured
         live: jump to the 27th, panel settled on the stale 28th. With the ref
         set, every path renderCalendar takes opens the day we asked for. */
      safe(function () { W._calRefDate = d; });
      /* a USER chose this day: automatic focusers (datalink's post-pull jump)
         stand down for 5 minutes rather than repainting their day over it */
      safe(function () { W.__mlsCalUserDayAt = Date.now(); });
      safe(function () { if (typeof W.calJump === 'function') W.calJump(d.slice(0, 7)); });
      safe(function () { if (typeof W.calOpenDay === 'function') W.calOpenDay(d); });
    };
  }
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function reconcile(key, verifyMore) {
    if (classic()) { teardown(); return; }
    safe(function () {
      if (!D.body.classList.contains(BODY_CLASS)) D.body.classList.add(BODY_CLASS);
    });
    installCss();
    var v = viewByKey[key || activeViewKey()];
    if (!v) return;
    var root = byId(v.id);
    if (!root || !styleVisible(root)) {
      viewStates[v.key] = { root: root, ready: false, primaryOwner: primaryOwnerToken(v) };
      return;
    }
    markFolds(v);
    var primaryInfo = mountPrimary(v);
    var moreInfo = mountMore(v, false, !!verifyMore);
    if (v.key === 'calendar') safe(function () { ensureCalStrip(true); });
    rememberView(v, root, primaryInfo, moreInfo);
  }

  function onResize() { liftToast(); schedule(activeViewKey(), true); }

  /* Frame-vs-timer race, the parity engine's occluded-tab lesson (2026-07-26):
     rAF never fires in an occluded tab, and MLS's normal posture is behind
     athenaOne. A pending latch reset only inside the rAF callback therefore
     freezes this module's reconcile the moment the tab is covered — the view
     observers keep calling schedule(), the latch is up, and nothing ever
     mounts. Whichever of the frame or the 300ms timer fires first runs;
     single-flight; timers throttle in background tabs but always fire. */
  function schedule(key, verifyMore) {
    if (stopped) return;
    key = key || activeViewKey();
    if (!viewByKey[key]) return;
    /* bit 1 = reconcile; bit 2 = verify the More rect after this frame */
    dirtyViews[key] = (dirtyViews[key] || 0) | 1 | (verifyMore === false ? 0 : 2);
    if (pending) return;
    var token = ++scheduleSeq;
    pending = token;
    var run = function () {
      if (pending !== token) return;
      pending = 0;
      var now = activeViewKey();
      if (!viewByKey[now] || !dirtyViews[now]) return;
      var reason = dirtyViews[now];
      dirtyViews[now] = 0;
      safe(function () { reconcile(now, !!(reason & 2)); });
    };
    if (W.requestAnimationFrame) W.requestAnimationFrame(run);
    setTimeout(run, 300);
  }

  function scheduleMoreVerification(v) {
    if (stopped || !v || moreVerifyPending[v.key]) return;
    var key = v.key;
    var token = ++moreVerifySeq;
    moreVerifyPending[key] = token;
    var run = function () {
      if (moreVerifyPending[key] !== token) return;
      moreVerifyPending[key] = 0;
      if (stopped || activeViewKey() !== key) return;
      var info = mountMore(v, true, false);
      var st = viewStates[key];
      if (st && info) {
        st.moreCount = info.count;
        st.moreHost = info.host;
        st.moreEl = info.el;
      }
    };
    if (W.requestAnimationFrame) W.requestAnimationFrame(run);
    setTimeout(run, 300);
  }

  function watch() {
    var nav = qs('.mainnav');
    if (nav && W.MutationObserver) {
      lastActiveKey = activeViewKey();
      var mo = new W.MutationObserver(function () {
        var next = activeViewKey();
        if (next === lastActiveKey) return;
        lastActiveKey = next;
        schedule(next, true);
      });
      mo.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
      observers.push(mo);
    }
    VIEWS.forEach(function (v) {
      var root = byId(v.id);
      if (!root || !W.MutationObserver) return;
      var mo = new W.MutationObserver(function (records) {
        /* No layout read in the observer. Only the active view, and only a
           mutation that can change owned furniture, may queue reconciliation. */
        if (mutationsConcernView(v, records || [])) schedule(v.key, false);
      });
      mo.observe(root, { childList: true, subtree: true });
      observers.push(mo);
    });
  }

  function teardown() {
    stopped = true;
    pending = 0;
    dirtyViews = Object.create(null);
    moreVerifyPending = Object.create(null);
    observers.forEach(function (o) { safe(function () { o.disconnect(); }); });
    observers = [];
    safe(function () { D.body.classList.remove(BODY_CLASS); });
    VIEWS.forEach(function (v) {
      safe(function () { D.body.classList.remove('mls-cv-open-' + v.key); });
      var p = byId('mlsCvNxt_' + v.key); if (p) p.remove();
      var m = byId('mlsCvMore_' + v.key); if (m) m.remove();
    });
    var s = byId(STYLE_ID); if (s) s.remove();
    safe(function () { W.removeEventListener('resize', onResize); });
    safe(function () { D.documentElement.style.removeProperty('--mls-toast-lift'); });
  }

  function start() {
    if (classic()) return;
    stopped = false;
    lastActiveKey = activeViewKey();
    reconcile(lastActiveKey, true);
    liftToast();
    watch();
    /* One resize listener, not two: the toast lift and the narrow-viewport
       primary anchor both depend on the viewport, and schedule() is
       rAF-debounced and writes nothing when nothing changed. */
    safe(function () { W.addEventListener('resize', onResize, { passive: true }); });
    /* View containers can mount after this module (the loader is async), so make
       a bounded number of retries and then stop.
       A CHAIN OF TIMEOUTS, NOT AN INTERVAL, and the distinction is not cosmetic:
       an interval that is cleared in its own callback still registers as a
       poller for the lifetime of anything that fails to reach the clear, and
       this app already carries 214 of them costing 2.4% of the main thread
       while idle. A timeout chain cannot outlive its own budget. */
    var tries = 0;
    (function retry() {
      if (stopped || tries++ > 20) return;
      setTimeout(function () {
        if (stopped) return;
        var key = activeViewKey();
        if (key !== lastActiveKey) {
          lastActiveKey = key;
          schedule(key, true);
        } else if (viewNeedsReconcile(viewByKey[key])) {
          schedule(key, false);
        }
        retry();
      }, 700);
    })();
  }

  window.__mlsCalmViews = {
    version: VERSION,
    views: VIEWS.map(function (v) { return v.key; }),
    reconcile: schedule,
    revert: function () { teardown(); delete window.__mlsCalmViews; return 'reverted'; }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();
})();
