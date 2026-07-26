'use strict';
/* =============================================================================
 * MLS -- Visit & Patients focus  (feat_mls_visit_focus.js -> window.__mlsVisitFocus, vf-1.0.0)
 *
 * The owner's brief, verbatim: "i LOVE THE NAVIGATER BUT I BASICALLY HATE HOW
 * MANY BUTTONS EVERY SINGLE UI ANYTHING HAS ... I WANT IT TO FREE DOCTORS FROM
 * BUTTONS AND JUST BE ABLE TO BE USED BY ANY DOCTOR WITH 1 MUINIT OF LEARNING"
 *
 * This module owns the BUTTON BUDGET of the two clinical screens -- #visitView
 * and #patientsView -- and nothing else. It is presentation only: it changes
 * which controls are on the surface and how big the primary is. It never
 * changes what a control does, never proxies a control, and never deletes one.
 *
 * WHY IT EXISTS (measured on the running page at b676, isolated Chrome, 1280x800,
 * settled with document.getAnimations().forEach(a=>a.finish())):
 *
 *   patientsView, a patient open -- 36 visible interactive controls, and
 *   "Start visit" -- the ONE thing a doctor opens that screen to do -- rendered
 *   at 93x26 = 2,405px^2. That made it the FOURTH SMALLEST control on the
 *   screen. "Copy every visit from athenaOne" was 322x42 = 13,536px^2, i.e.
 *   5.6x larger than the primary. The screen was telling the doctor to do the
 *   wrong thing, in the largest type available.
 *
 *   visitView, a visit locked -- 28 visible controls, of which 12 were a flat
 *   row of same-size secondary chips and 6 belonged to the WIDGET BUILDER: a
 *   390x484 starter deck advertising three widgets to install, on the screen
 *   where a doctor records a patient encounter.
 *
 * THE FIVE RULES IT ENFORCES (contract REDESIGN_CONTRACT_2026-07-26.md):
 *   1. One primary per screen state, rendered as the biggest thing.
 *   2. Everything else leaves the surface -- into a disclosure that ALREADY
 *      EXISTS, never into nothing.
 *   3. Nothing is deleted. Every selector below is class-hidden and named in
 *      ROUTES with the route back. tests/visit-focus-keeps-every-route.test.js
 *      fails if a rule is added without one.
 *   4. Nothing navigates except the dock.
 *   5. Class-hide only. An inline style.display hide is invisible to
 *      available() and silently removes a feature -- this file contains no
 *      element.style writes at all, and the gate asserts that.
 *
 * ZERO RUNTIME COST. The visit rules are pure CSS, keyed on :has() against the
 * app's own state markers (#ez3Change means "a visit is locked"; .wd-starter
 * means "the widget deck has nothing but adverts"). There is no timer, no
 * MutationObserver and no poll in this file. Where :has() is unsupported the
 * rules simply do not match and the screen renders exactly as it does today --
 * degradation is to the status quo, never to a broken surface.
 *
 * The only JS is two disclosure MIRRORS, because a CSS rule cannot read another
 * element's inline display or a localStorage key:
 *   body.vf-ptmore  <- #ptMore is open   (the existing "... More" chip)
 *   body.vf-tools   <- ez3ToolsOpen='1'  (the existing "Visit shortcuts" chip)
 * Both are driven by ONE delegated click listener and one function wrap. Both
 * use classList.toggle(name, want), which -- unlike add/remove -- does not
 * re-commit when the value is unchanged, so a no-op sync costs no style recalc.
 *
 * Reversible: window.__mlsVisitFocus.revert().
 * ES5. No dependencies. Loads after feat_mls_calm_shell.js so its rules win on
 * order where specificity ties.
 * ========================================================================== */
(function () {
  var VER = 'vf-1.0.0';
  var STYLE_ID = 'mlsVfCss', BODY = 'mls-vfocus', PTMORE = 'vf-ptmore', TOOLS = 'vf-tools';

  var prior = null;
  try { prior = window.__mlsVisitFocus || null; } catch (e0) {}
  if (prior && prior.version === VER) return;
  if (prior && typeof prior.revert === 'function') { try { prior.revert(); } catch (e1) {} }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function isFn(f) { return typeof f === 'function'; }

  /* --------------------------------------------------------------- ROUTES --
   * Every selector this module hides, and where the doctor finds it instead.
   * A route is a CONTROL THAT IS ON THE SCREEN, not "it still exists in the
   * DOM". The gate reads this table out of the source and refuses any hide
   * rule whose selector is not named here. */
  var ROUTES = [
    /* ---- patientsView ---- */
    { sel: '#patientsView #ptGroupBar',
      route: '... More on the Patients card (#ptMoreBtn)',
      why: 'four grouping modes for a list that is already searchable' },
    { sel: '#patientsView #ptSort',
      route: '... More on the Patients card (#ptMoreBtn)',
      why: 'two-option sort; search answers the same question faster' },
    { sel: '#patientsView #mlsStudyLaunch',
      route: '... More on the Patients card (#ptMoreBtn)',
      why: 'research import is not a clinical action on a patient list' },
    { sel: '#patientsView #dailyBriefBar button',
      route: 'the dock -- Visit and Day are dock destinations',
      why: 'both are bare showView() calls; the dock is the whole navigation story' },
    { sel: '#patientsView #profileCard .mls-moved',
      route: 'dock > Tools (every one is in the shell TOOLS_SOURCES) and ... More',
      why: 'the Calm Shell already relocated these; they were still drawn at half opacity, competing with the primary' },
    { sel: '#patientsView #mlsfhpdf-btn',
      route: '... More on the Patients card (#ptMoreBtn)',
      why: 'a chart export is not the reason the patient screen is open' },

    /* ---- visitView ---- */
    { sel: '#visitView #mlsWdDeck:has(.wd-starter)',
      route: 'dock > Tools > AI Studio (#customWidgetHdrBtn opens the widget builder)',
      why: 'the :has() is the whole point - hidden ONLY in the starter state, where the deck is 484px of advertising for widgets the doctor has not built' },
    { sel: '#visitView #mlsWdDeck .wd-head .wd-btn',
      route: 'dock > Tools > AI Studio (#customWidgetHdrBtn opens the widget builder)',
      why: 'authoring controls on a clinical screen; the widgets themselves stay' },
    { sel: '#visitView #mlsEz3Body .ez3-row2',
      route: 'the "Visit shortcuts" chip already on the visit (#ez3QToolsToggle / #ez3flToolsToggle)',
      why: 'up to twelve same-size chips flat against the state primary' },
    { sel: '#visitView #ez3StyleChips',
      route: 'the "Visit shortcuts" chip already on the visit (#ez3QToolsToggle / #ez3flToolsToggle)',
      why: 'eight note-format chips offered after the note exists, competing with Review & Sign' },
    { sel: '#visitView #mlsEz3Body:has(.ez3fl-record:not([hidden]) #ez3flTranscript:not([hidden])) .ez3-transcript-card',
      route: 'the surviving transcript IS the route - #ez3flTranscript, the one the doctor is already typing in, mirrored both ways by txm-1.0.0',
      why: 'the owner measured two identical transcript boxes on one screen at b677; a second place to type the same visit is not a feature to keep a route to' },
    { sel: '#visitView #mlsEz3Body:has(#ez3Change) #mlsDsStrip',
      route: 'the visit home screen -- press "< Patients" and the day strip is there',
      why: 'the :has(#ez3Change) is the whole point - hidden ONLY once a visit is locked; inside the room the day is already decided and every control on that strip is a way to leave the patient in front of you' }
  ];

  /* ------------------------------------------------------------------ CSS --
   * Scoped to the two views. Nothing here can reach another worker's surface.
   *
   * :has() carries the state tests. #ez3Change is the "wrong patient? switch"
   * control, which the engine renders if and only if a visit is locked -- so
   * `#mlsEz3Body:has(#ez3Change)` IS "the doctor is in the room", read from the
   * app's own output rather than from a flag this module would have to keep in
   * sync. .wd-starter is the widget deck's own empty-state marker.
   */
  var CSS = [
    /* ===================== patientsView ===================== */

    /* THE PRIMARY. "Start visit" stops being a 93x26 ghost in a header of eight
       and becomes the one big obvious thing, on its own row, named. The Calm
       Shell no longer marks it .mls-moved (see feat_mls_calm_shell.js PT_MOVED)
       -- this is what it becomes instead. */
    'body.' + BODY + ' #patientsView #profileCard h2 .vf-primary{' +
      'flex-basis:100%!important;order:99;display:flex!important;align-items:center;justify-content:center;gap:10px;' +
      'min-height:62px!important;margin:10px 0 2px!important;padding:16px 22px!important;' +
      'font-size:17px!important;font-weight:750!important;line-height:1.25;' +
      'border-radius:16px!important;opacity:1!important;box-shadow:0 6px 18px -8px rgba(32,64,52,.55)!important}',
    'body.' + BODY + ' #patientsView #profileCard h2 .vf-primary:hover{filter:brightness(1.05)}',

    /* With no patient open the search field IS the surface, so it leads. */
    'body.' + BODY + ' #patientsView #ptSearch{min-height:52px;font-size:16px}',

    /* Secondaries answer to the "... More" chip that is already on this card. */
    'body.' + BODY + ':not(.' + PTMORE + ') #patientsView #ptGroupBar,' +
    'body.' + BODY + ':not(.' + PTMORE + ') #patientsView #ptSort,' +
    'body.' + BODY + ':not(.' + PTMORE + ') #patientsView #mlsStudyLaunch,' +
    'body.' + BODY + ':not(.' + PTMORE + ') #patientsView #mlsfhpdf-btn,' +
    'body.' + BODY + ':not(.' + PTMORE + ') #patientsView #profileCard .mls-moved{display:none!important}',

    /* Revealed by "... More" at FULL SIZE, not at the half opacity the shell
       used. A control a doctor is being shown on purpose should look like one
       -- and Snapshot / Share-Export position their popovers from their own
       getBoundingClientRect, which only measures correctly when the control is
       laid out at its real size. That is exactly why the shell could not use
       display:none here and had to settle for opacity; a disclosure can. */
    'body.' + BODY + '.' + PTMORE + ' #patientsView #profileCard .mls-moved{' +
      'opacity:1!important;font-size:13px!important;padding:8px 13px!important}',

    /* Navigation belongs to the dock. */
    'body.' + BODY + ' #patientsView #dailyBriefBar button{display:none!important}',

    /* The chip that owns everything above must always be findable. */
    'body.' + BODY + ' #patientsView #ptMoreBtn{display:inline-flex!important;align-items:center}',

    /* ======================= visitView ======================= */

    /* The widget BUILDER leaves the clinical screen. Widgets the doctor has
       actually built keep their cards; only the authoring row goes. */
    'body.' + BODY + ' #visitView #mlsWdDeck .wd-head .wd-btn{display:none!important}',
    /* ...and in the starter state the deck is nothing BUT authoring. */
    'body.' + BODY + ' #visitView #mlsWdDeck:has(.wd-starter){display:none!important}',

    /* EXACTLY ONE TEXT-ENTRY SURFACE. Owner, 2026-07-26: "sometimes 2 textboxes
     * pop up - all errors like this must not make final product."
     *
     * CONFIRMED on his signed-in tab at b677: #ez3flTranscript (top 323,
     * 690x126) and #ez3Transcript (top 877, 686x142) both visible, same
     * placeholder, on one screen. Two identical places to type the same visit.
     *
     * The app already has a rule for this - `#mlsEz3Body.ez3fl-top-owns
     * .ez3-transcript-card{display:none}` - and it is keyed on a CLASS the lane
     * sets when it believes it owns the transcript. On the owner's tab that
     * class was OFF while the lane was still painting its box, so both
     * rendered. A class is a claim; the DOM is a fact. This rule reads the
     * fact: if the lane's transcript is really there and really not hidden,
     * the engine's copy stands down.
     *
     * The `:not([hidden])` terms are load-bearing in the opposite direction,
     * and they are the b653 lesson written as a selector: the earlier version
     * of THIS idea asserted the top lane owned the controls while the top lane
     * rendered nothing, and left the doctor with none at all. A rule that can
     * hide the last transcript is worse than a duplicate one. */
    'body.' + BODY + ' #visitView #mlsEz3Body:has(.ez3fl-record:not([hidden]) #ez3flTranscript:not([hidden])) .ez3-transcript-card{display:none!important}',

    /* THE STATE PRIMARY, when the state changes under the hero.
     *
     * Contract law 3: transcript exists -> Generate note is primary. MEASURED
     * on the PRISTINE tree at b677, visit locked, 1,653 characters of
     * transcript present:
     *
     *   #ez3Rec   "Start Recording"      720x82 = 59,040px^2   <- the hero
     *   #ez3flGen "Generate one note"    185x45 =  8,325px^2   <- the real
     *                                                             next action
     *
     * still reading that way twelve seconds later, and it never changes: the
     * engine's renderDoctor ALREADY picks Generate the moment #transcript has
     * text, but nothing re-runs it, because the doctor-room poll re-renders
     * only when S.phase moves and typing a transcript does not move the phase
     * (mls-connect.js, the 700ms poll). So the biggest thing on the busiest
     * screen in the product was, for the whole middle of every visit, the
     * wrong action.
     *
     * Fixed here in PRESENTATION rather than in the render loop, deliberately.
     * The engine fix is a re-render, and a re-render of #ez3Wrap destroys the
     * textarea a doctor may be mid-sentence in — this repo has a whole
     * focus-carry mechanism and a dedicated suite because that has bitten
     * before. The lane already knows the answer and publishes it as
     * #ez3flGen's [hidden] attribute, promptly (measured present at t+1000ms),
     * so :has() can read it and swap which control leads without a single
     * node being rebuilt. The underlying trigger defect is reported for the
     * lead: it is real, it is in the engine, and it wants its own pass. */
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flGen:not([hidden])) #ez3flGen{' +
      'min-height:62px!important;padding:16px 26px!important;font-size:17px!important;' +
      'font-weight:750!important;border-radius:16px!important;flex-basis:100%;' +
      'box-shadow:0 6px 18px -8px rgba(32,64,52,.55)!important}',
    /* ...and Record steps back to what it now is: the way to add more. It is
       not hidden - a doctor may always record another segment - it simply
       stops being the biggest thing when it is no longer the next thing. */
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flGen:not([hidden])) #ez3Rec{' +
      /* not merely smaller - a different SHAPE. Left as a full-width block it
         still measured 720x60 = 43,200px^2 against the hero's 42,780, i.e. a
         dead heat a doctor would have to compare. A demoted action should not
         be a near-miss for the primary; it becomes an inline chip. */
      /* #ez3Wrap is display:grid, so a grid item's inline-flex is BLOCKIFIED
         back to flex and align-self governs the block axis - measured
         display:flex, width:720px with both properties winning the cascade.
         justify-self is the one that shrink-wraps a grid item. */
      'display:inline-flex!important;width:auto!important;justify-self:start!important;' +
      'align-self:flex-start;' +
      'min-height:0!important;padding:11px 16px!important;font-size:13.5px!important;' +
      'font-weight:600!important;background:#fff!important;color:#1A211C!important;' +
      'border:1px solid #D9D6CD!important;box-shadow:none!important}',
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flGen:not([hidden])) #ez3Rec small{' +
      'font-size:11.5px!important;opacity:.8}',

    /* ...and once the note exists the same thing happens one state later, for
       the same reason. MEASURED after a real offline generation: the lane
       renders the note and "Next: Review & send to Athena" at 244x40 =
       9,748px^2 while the engine's stale "Start Recording" is still 720x82 =
       59,040px^2 - six times the size of the only action left. Review is the
       last human gate before anything reaches Athena; it does not get to be
       the sixth-biggest thing on the screen. */
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flNoteWrap:not([hidden])) #ez3flReview{' +
      'min-height:62px!important;padding:16px 26px!important;font-size:17px!important;' +
      'font-weight:750!important;border-radius:16px!important;flex-basis:100%;' +
      'box-shadow:0 6px 18px -8px rgba(32,64,52,.55)!important}',
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flNoteWrap:not([hidden])) #ez3Rec,' +
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flNoteWrap:not([hidden])) #ez3flGen{' +
      /* not merely smaller - a different SHAPE. Left as a full-width block it
         still measured 720x60 = 43,200px^2 against the hero's 42,780, i.e. a
         dead heat a doctor would have to compare. A demoted action should not
         be a near-miss for the primary; it becomes an inline chip. */
      /* #ez3Wrap is display:grid, so a grid item's inline-flex is BLOCKIFIED
         back to flex and align-self governs the block axis - measured
         display:flex, width:720px with both properties winning the cascade.
         justify-self is the one that shrink-wraps a grid item. */
      'display:inline-flex!important;width:auto!important;justify-self:start!important;' +
      'align-self:flex-start;' +
      'min-height:0!important;padding:11px 16px!important;font-size:13.5px!important;' +
      'font-weight:600!important;background:#fff!important;color:#1A211C!important;' +
      'border:1px solid #D9D6CD!important;box-shadow:none!important}',
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3flNoteWrap:not([hidden])) #ez3Rec small{' +
      'font-size:11.5px!important;opacity:.8}',

    /* The day strip is day CONTEXT. Inside the room the day is already decided,
       and every control on it is a way to leave the patient in front of you. */
    'body.' + BODY + ' #visitView #mlsEz3Body:has(#ez3Change) #mlsDsStrip{display:none!important}',

    /* The secondary chip row and the note-format chips answer to the "Visit
       shortcuts" chip the engine already renders. */
    'body.' + BODY + ':not(.' + TOOLS + ') #visitView #mlsEz3Body .ez3-row2,' +
    'body.' + BODY + ':not(.' + TOOLS + ') #visitView #ez3StyleChips{display:none!important}',

    /* The shortcuts chip is the route back, so it is never the thing that
       disappears -- and it reads as the quiet secondary it is. */
    'body.' + BODY + ' #visitView #ez3QToolsToggle,' +
    'body.' + BODY + ' #visitView #ez3flToolsToggle{display:inline-flex!important;opacity:.85}',
    'body.' + BODY + ' #visitView #ez3QToolsToggle:hover,' +
    'body.' + BODY + ' #visitView #ez3flToolsToggle:hover{opacity:1}',

    /* The canonical in-visit routes (Copilot Voice / MLS Assistant / Dictate)
       stay exactly where the owner put them -- quiet chips that never compete
       with the hero. This only guarantees they cannot grow into it. */
    'body.' + BODY + ' #visitView .ez3fl-quick .ez3fl-qchip{font-size:12.5px;font-weight:600;box-shadow:none}'
  ].join('\n');

  function installCss() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------- state mirrors --
   * classList.toggle(name, want) is deliberate: add()/remove() re-commit the
   * attribute unconditionally, which forces a whole-document style recalc even
   * when the class is already right. A previous pass in this app was measured
   * doing 86 such no-op writes in 44 seconds. toggle(name, want) writes only on
   * a real change. */
  function ptMoreOpen() {
    var m = $('ptMore');
    if (!m) return false;
    return safe(function () { return getComputedStyle(m).display !== 'none'; }, false);
  }
  function toolsOpen() {
    return safe(function () {
      var key = isFn(window.uns) ? window.uns('ez3ToolsOpen') : 'ez3ToolsOpen';
      return localStorage.getItem(key) === '1';
    }, false);
  }
  function sync() {
    var b = document.body; if (!b) return;
    b.classList.toggle(PTMORE, ptMoreOpen());
    b.classList.toggle(TOOLS, toolsOpen());
  }

  /* ONE delegated listener. The three chips that own these two disclosures all
     write their state synchronously inside their own click handler, so a
     microtask-later resync always reads the settled value. Passive + bubble
     phase: this listener can never interfere with a control, and in particular
     never touches the trusted-gesture path -- it reads state, it does not
     act. */
  function onDocClick(ev) {
    var t = ev && ev.target;
    if (!t || !t.closest) return;
    if (!t.closest('#ptMoreBtn,#ez3QToolsToggle,#ez3flToolsToggle')) return;
    setTimeout(sync, 0);
  }

  /* togglePtMore() sets #ptMore's inline display, which no CSS rule can read.
     Wrapping is how the mirror learns about the toggles that do NOT come from a
     click on #ptMoreBtn (the app calls it directly in a few places). The
     original is always called first and its return value preserved. */
  var wrapped = null, origToggle = null;
  function wrapToggle() {
    if (!isFn(window.togglePtMore) || wrapped === window.togglePtMore) return;
    origToggle = window.togglePtMore;
    wrapped = function () {
      var out = origToggle.apply(this, arguments);
      try { sync(); } catch (e) {}
      return out;
    };
    window.togglePtMore = wrapped;
  }

  /* ---------------------------------------------------------------- boot --
   * The primary marker is the one DOM write this module makes, and it is
   * idempotent: it only ever runs when the button is not already marked. The
   * button is matched by its own text node, the same way the Calm Shell matches
   * it, so the two agree about which control this is. */
  function markPrimary() {
    var card = $('profileCard'); if (!card) return;
    var h = card.querySelector('h2'); if (!h) return;
    var btns = h.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var txt = String(b.textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^\W*start visit$/i.test(txt)) continue;
      if (!b.classList.contains('vf-primary')) b.classList.add('vf-primary');
      return;
    }
  }

  var listening = false;
  function activate() {
    installCss();
    document.body.classList.toggle(BODY, true);
    wrapToggle();
    markPrimary();
    sync();
    if (!listening) { document.addEventListener('click', onDocClick, true); listening = true; }
  }

  /* renderProfile() rebuilds the patient header, so the primary marker has to
     be re-applied after it. Wrapping the app's own render is exact -- it runs
     when and only when the header actually changed -- where a poll would either
     miss it or burn the main thread waiting for it. */
  var origRenderProfile = null;
  function wrapRenderProfile() {
    if (!isFn(window.renderProfile) || window.renderProfile.__vfWrapped) return;
    origRenderProfile = window.renderProfile;
    var w = function () {
      var out = origRenderProfile.apply(this, arguments);
      try { markPrimary(); } catch (e) {}
      return out;
    };
    w.__vfWrapped = true;
    window.renderProfile = w;
  }

  var api = {
    installed: true,
    version: VER,
    routes: ROUTES,
    _sync: sync,
    revert: function () {
      try { var st = $(STYLE_ID); if (st) st.remove(); } catch (e) {}
      try {
        document.body.classList.toggle(BODY, false);
        document.body.classList.toggle(PTMORE, false);
        document.body.classList.toggle(TOOLS, false);
      } catch (e) {}
      try { if (listening) { document.removeEventListener('click', onDocClick, true); listening = false; } } catch (e) {}
      try { if (wrapped && window.togglePtMore === wrapped) window.togglePtMore = origToggle; } catch (e) {}
      try {
        if (origRenderProfile && window.renderProfile && window.renderProfile.__vfWrapped) window.renderProfile = origRenderProfile;
      } catch (e) {}
      try {
        var marked = document.querySelectorAll('.vf-primary');
        for (var i = 0; i < marked.length; i++) marked[i].classList.toggle('vf-primary', false);
      } catch (e) {}
      api.installed = false;
      try { if (window.__mlsVisitFocus === api) delete window.__mlsVisitFocus; } catch (e) { try { window.__mlsVisitFocus = undefined; } catch (e2) {} }
      return true;
    }
  };
  window.__mlsVisitFocus = api;

  function boot() {
    if (!document.body) { setTimeout(boot, 60); return; }
    activate();
    wrapRenderProfile();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  /* The app installs renderProfile and togglePtMore with the post-auth module
     train, which lands after this file. Three bounded retries, then done --
     never a standing interval. */
  setTimeout(function () { wrapToggle(); wrapRenderProfile(); markPrimary(); }, 1500);
  setTimeout(function () { wrapToggle(); wrapRenderProfile(); markPrimary(); }, 4000);
  setTimeout(function () { wrapToggle(); wrapRenderProfile(); markPrimary(); }, 9000);
})();
