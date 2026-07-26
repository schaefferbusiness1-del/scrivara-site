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
 * CHURN. This module installs no interval. It reconciles on one MutationObserver
 * over the nav rail (which view is `.on`) plus one debounced observer per mounted
 * view, and every write is guarded by a read — the reconcile of an unchanged
 * screen performs zero DOM writes. (b640: 86 no-op body-class writes in 44s were
 * a whole-document recalc 1.4x/sec. classList.add/remove re-commit
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
        label: function () {
          var d = calRefDate();
          return d ? ('Pull ' + d.label) : 'Pull this day’s schedule';
        },
        sub: 'Reads that day’s appointments from athenaOne. Nothing is written.',
        available: function () {
          return !!(qs('#mlsT3Empty .t3e-pull') || typeof W.pullScheduleViaAssist === 'function');
        },
        act: function () {
          /* Prefer the app's own button so any handler it grows comes with it.
             It only exists in the calendar's empty state, so a loaded calendar
             falls back to the SAME call that button makes:
             feat_task3_frontsync.js:477  pb.onclick = window.pullScheduleViaAssist() */
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
    {
      key: 'studio',
      id: 'studioView',
      /* 33 controls: a Copilot, a widget builder, a twelve-tile gallery, and a
         template shelf whose fourth button is "Delete ALL templates" — a
         destructive act sitting on the open surface of a browsing screen. */
      /* Measured on a running page: #studioTemplates is an eleven-chip widget
         gallery, and the template shelf's fourth button is "🗑 Delete ALL
         templates". The Copilot's own example chips are NOT folded — on an
         empty Copilot they are the thing that teaches a doctor what to type,
         which is the one-minute test rather than an obstacle to it. */
      fold: [
        '#studioView #studioTemplates',     /* the widget gallery */
        '#studioView .mls-cv-fold-tpl'      /* marked at mount: the template shelf row */
      ],
      more: { label: 'More studio tools', anchor: '#studioView .card' },
      /* NO primary BUTTON here, on purpose, and this is the one place the
         contract's "every screen gets its #ez3Nxt" is met by promotion rather
         than by addition. The next step on AI Studio is to ask a question, and
         the control for that already exists: #copilotInput. Adding a big green
         button whose entire job is to focus a text box six pixels below it
         would be one more button on the screen the owner said has too many.
         So the REAL control is made the biggest thing instead (see css()). */
      primary: null
    },
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
      'body.' + BODY_CLASS + ' .toast{bottom:var(--mls-toast-lift,96px);pointer-events:none}',
      /* AI Studio's primary is a PROMOTION, not an addition: the ask box the
         app already ships becomes the biggest thing on the screen. */
      'body.' + BODY_CLASS + ' #studioView #copilotInput{min-height:62px;font-size:16.5px;padding:14px 16px;border-radius:14px}',
      'body.' + BODY_CLASS + ' #studioView #copilotSendBtn{min-width:56px;min-height:56px;font-size:19px;border-radius:14px}',
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
    if (v.key === 'studio') {
      /* The template shelf has no id and is not always rendered, so it is
         identified by the controls it contains, never by a class we hope
         exists. Its row is marked, not each button, so the shelf's labels go
         with it. */
      qsa('#studioView button').forEach(function (b) {
        var t = String(b.textContent || '');
        if (/upload templates|upload a folder|starter op-note templates|delete all templates/i.test(t)) {
          var row = b.parentElement;
          if (row && row.id !== 'studioView' && row !== byId(v.id)) mark([row], 'mls-cv-fold-tpl');
        }
      });
    }
  }

  function foldCount(v) {
    var n = 0;
    v.fold.forEach(function (sel) { n += qsa(sel).length; });
    return n;
  }

  function mountMore(v) {
    var host = qs(v.more.anchor);
    if (!host) return;
    var id = 'mlsCvMore_' + v.key;
    var existing = byId(id);
    /* Nothing folded on this screen right now -> no disclosure. An empty "More"
       is exactly the kind of button this module exists to remove. */
    if (!foldCount(v)) { if (existing) existing.remove(); return; }
    var b = existing || D.createElement('button');
    if (b.id !== id) b.id = id;
    if (b.type !== 'button') b.type = 'button';
    if (b.className !== 'mls-cv-more') b.className = 'mls-cv-more';
    var open = isOpen(v);
    var want = (open ? 'Hide' : 'Show') + ' ' + v.more.label.replace(/^More /, 'more ');
    if (b.getAttribute('aria-expanded') !== String(open)) b.setAttribute('aria-expanded', String(open));
    if (b.textContent !== want) b.textContent = want;
    b.onclick = function () { toggleOpen(v); };
    /* Never above the primary. When both land in the same card the disclosure
       must sit UNDER the one big obvious thing, or the screen has two things
       competing for first read — which is the defect, not the fix.
       Every branch here is guarded by a read: a reconcile of an unchanged
       screen must perform no DOM write at all. */
    var nxt = byId('mlsCvNxt_' + v.key);
    if (nxt && nxt.parentElement === host) {
      if (nxt.nextSibling !== b) host.insertBefore(b, nxt.nextSibling);
    } else if (host.firstChild !== b) {
      host.insertBefore(b, host.firstChild);
    }

    /* THE INVARIANT: a fold whose route back cannot be SEEN unfolds itself.
       Learned by measurement, not by reasoning. The analysis view's disclosure
       mounted into a card that its own rebuild module had replaced: the button
       existed, was in the DOM, had an onclick, and had rect 0x0 — so the fold
       hid a control and left no way to it. Every check that asserts "the
       disclosure exists" passes on that. Assert that it RENDERS.
       Cost is one rect read per reconcile of a mounted view. */
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
    if (!v.primary) return;
    var id = 'mlsCvNxt_' + v.key;
    var el = byId(id);
    var ok = safe(function () { return v.primary.available(); }, false);
    if (!ok) { if (el) el.remove(); return; }
    var host = qs(v.primary.anchor);
    if (!host) return;
    var label = safe(function () { return String(v.primary.label() || ''); }, '');
    if (!label) { if (el) el.remove(); return; }
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
  }

  /* ------------------------------------------------------------- reconcile */

  var observers = [];
  var pending = 0;

  function activeViewKey() {
    var on = qs('.mainnav .navtab.on');
    if (!on) return '';
    var id = String(on.id || '');
    var m = /^nav_(.+)$/.exec(id);
    return m ? m[1] : '';
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

  function reconcile() {
    if (classic()) { teardown(); return; }
    safe(function () {
      if (!D.body.classList.contains(BODY_CLASS)) D.body.classList.add(BODY_CLASS);
    });
    installCss();
    liftToast();
    VIEWS.forEach(function (v) {
      var root = byId(v.id);
      if (!root || !visible(root)) return;
      markFolds(v);
      mountPrimary(v);
      mountMore(v);
    });
  }

  function schedule() {
    if (pending) return;
    pending = (W.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      pending = 0;
      safe(reconcile);
    });
  }

  function watch() {
    var nav = qs('.mainnav');
    if (nav && W.MutationObserver) {
      var mo = new W.MutationObserver(schedule);
      mo.observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true });
      observers.push(mo);
    }
    VIEWS.forEach(function (v) {
      var root = byId(v.id);
      if (!root || !W.MutationObserver) return;
      var mo = new W.MutationObserver(function () {
        /* Only re-mount when this module's own furniture went missing. The
           calendar rebuilds its grid constantly; reconciling on every rebuild
           would make this module a churn source instead of a cure. */
        if (!visible(root)) return;
        var needPrimary = !!v.primary && !byId('mlsCvNxt_' + v.key) && safe(function () { return v.primary.available(); }, false);
        var needMore = foldCount(v) > 0 && !byId('mlsCvMore_' + v.key);
        if (needPrimary || needMore) schedule();
      });
      mo.observe(root, { childList: true, subtree: true });
      observers.push(mo);
    });
  }

  function teardown() {
    observers.forEach(function (o) { safe(function () { o.disconnect(); }); });
    observers = [];
    safe(function () { D.body.classList.remove(BODY_CLASS); });
    VIEWS.forEach(function (v) {
      safe(function () { D.body.classList.remove('mls-cv-open-' + v.key); });
      var p = byId('mlsCvNxt_' + v.key); if (p) p.remove();
      var m = byId('mlsCvMore_' + v.key); if (m) m.remove();
    });
    var s = byId(STYLE_ID); if (s) s.remove();
    safe(function () { W.removeEventListener('resize', liftToast); });
    safe(function () { D.documentElement.style.removeProperty('--mls-toast-lift'); });
  }

  function start() {
    if (classic()) return;
    reconcile();
    watch();
    safe(function () { W.addEventListener('resize', liftToast, { passive: true }); });
    /* View containers can mount after this module (the loader is async), so make
       a bounded number of retries and then stop.
       A CHAIN OF TIMEOUTS, NOT AN INTERVAL, and the distinction is not cosmetic:
       an interval that is cleared in its own callback still registers as a
       poller for the lifetime of anything that fails to reach the clear, and
       this app already carries 214 of them costing 2.4% of the main thread
       while idle. A timeout chain cannot outlive its own budget. */
    var tries = 0;
    (function retry() {
      if (tries++ > 20) return;
      setTimeout(function () { schedule(); retry(); }, 700);
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
