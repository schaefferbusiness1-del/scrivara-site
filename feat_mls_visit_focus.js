'use strict';
/* =============================================================================
 * MLS -- Visit & Patients focus  (feat_mls_visit_focus.js -> window.__mlsVisitFocus, vf-1.1.0)
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
 * vf-1.1.0 RETIRES THE ADVANCED VISIT WORKSPACE (owner, 2026-07-26: "get rid
 * of and completely rework the advanced visit workspace from scratch and make
 * sure the op notes button is easily accessible"). See the CSS section for the
 * measurements; the short version is that one button hid a 3,143px note card
 * from a doctor who had just generated the note, and the door was never
 * load-bearing for the send path it appeared to guard.
 *
 * NEAR-ZERO RUNTIME COST. Every visit rule is pure CSS, keyed on :has() against
 * the app's own state markers (#ez3Change means "a visit is locked";
 * .wd-starter means "the widget deck has nothing but adverts"). No timer, no
 * poll. Where :has() is unsupported the rules simply do not match and the
 * screen renders as it does today -- degradation is to the status quo, never to
 * a broken surface.
 *
 * The JS is three MIRRORS, because a CSS rule cannot read another element's
 * inline display, a localStorage key, or a textarea's value:
 *   body.vf-ptmore     <- #ptMore is open      (the existing "... More" chip)
 *   body.vf-tools      <- ez3ToolsOpen='1'     (the existing "Visit shortcuts" chip)
 *   body.mls-note-live <- #noteBox has a note  (vf-1.1.0; replaces the door)
 * The first two ride ONE delegated click listener and one function wrap. The
 * third needs a MutationObserver -- exactly one, on exactly one element,
 * attributes only -- because a note arrives without a click and setting a
 * textarea's .value mutates no DOM. All three use classList.toggle(name, want),
 * which -- unlike add/remove -- does not re-commit when the value is unchanged,
 * so a no-op sync costs no style recalc.
 *
 * Reversible: window.__mlsVisitFocus.revert().
 * ES5. No dependencies. Loads after feat_mls_calm_shell.js so its rules win on
 * order where specificity ties.
 * ========================================================================== */
(function () {
  var VER = 'vf-1.1.0';
  var STYLE_ID = 'mlsVfCss', BODY = 'mls-vfocus', PTMORE = 'vf-ptmore', TOOLS = 'vf-tools';
  /* vf-1.1.0: the state that replaced the Advanced-visit-workspace door. It is
     a FACT about the document - #noteBox holds a real note - never a claim
     something set when it believed a note had arrived. The whole reason the
     door had to go is that the app already knows this; it was just refusing to
     act on it without a click. */
  var NOTE = 'mls-note-live';

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
    { sel: '#patientsView .mlsfhpdf-btn',
      route: '... More on the Patients card (#ptMoreBtn)',
      why: 'a chart export is not the reason the patient screen is open. NOTE: this is a CLASS, not an id - feat_fullhistory_pdf.js styles .mlsfhpdf-btn, and the first version of this rule wrote #mlsfhpdf-btn, matched nothing, and hid nothing. A selector that matches zero elements looks exactly like a fix that shipped.' },

    /* ---- visitView ---- */
    { sel: '#visitView #mlsWdDeck:has(.wd-starter)',
      route: 'dock > Tools > AI Studio (#customWidgetHdrBtn opens the widget builder)',
      why: 'the :has() is the whole point - hidden ONLY in the starter state, where the deck is 484px of advertising for widgets the doctor has not built' },
    { sel: '#visitView #mlsWdDeck .wd-head .wd-btn',
      route: 'dock > Tools > AI Studio (#customWidgetHdrBtn opens the widget builder)',
      why: 'authoring controls on a clinical screen; the widgets themselves stay' },
    { sel: '#visitView #mlsEz3Body .ez3-row2:not(:has(#ez3Prep)):not(:has(#ez3Prep2))',
      route: 'the "Visit shortcuts" chip already on the visit (#ez3QToolsToggle / #ez3flToolsToggle)',
      why: 'up to twelve same-size chips flat against the state primary. The :not(:has()) is an OWNER ORDER (2026-07-26, "make sure the op notes button is easily accessible"): the row that carries the op-note chip survives the fold' },
    { sel: '#visitView #mlsEz3Body .ez3-row2 > *:not(#ez3Prep):not(#ez3Prep2)',
      route: 'the "Visit shortcuts" chip already on the visit (#ez3QToolsToggle / #ez3flToolsToggle)',
      why: 'inside the surviving row, everything except the op-note chip still folds - the exemption is for op notes, not for the row' },
    { sel: '#visitView #ez3StyleChips',
      route: 'the "Visit shortcuts" chip already on the visit (#ez3QToolsToggle / #ez3flToolsToggle)',
      why: 'eight note-format chips offered after the note exists, competing with Review & Sign' },
    { sel: '#visitView #mlsEz3Body:has(.ez3fl-record:not([hidden]) #ez3flTranscript:not([hidden])) .ez3-transcript-card',
      route: 'the surviving transcript IS the route - #ez3flTranscript, the one the doctor is already typing in, mirrored both ways by txm-1.0.0',
      why: 'the owner measured two identical transcript boxes on one screen at b677; a second place to type the same visit is not a feature to keep a route to' },
    { sel: '#visitView #mlsEz3Body:has(#ez3Change) #mlsDsStrip',
      route: 'the visit home screen -- press "< Patients" and the day strip is there',
      why: 'the :has(#ez3Change) is the whole point - hidden ONLY once a visit is locked; inside the room the day is already decided and every control on that strip is a way to leave the patient in front of you' },

    { sel: '#visitView #mlsEz3Body .ez3-row2::before',
      route: 'none is needed and the gate is right to ask - this is a ::before CAPTION, not a control. It said "GET THE DAY READY" over a group that the fold reduced to one button, and a heading over a single button is chrome explaining chrome',
      why: 'the button it captions already says what it does' },

    /* ---- the retired Advanced visit workspace (vf-1.1.0) ---- */
    { sel: '#visitView #mlsEz3 .ez3fl-openws',
      route: 'nothing needs it any more - the note it used to hide now surfaces on state, and the two consoles it also hid are named below',
      why: 'owner 2026-07-26: "get rid of and completely rework the advanced visit workspace from scratch". This was the one visible door (feat_athena_tooltip_dedupe makes it the owner and hides .ez3-advrow as its duplicate)' },
    { sel: '#visitView #mlsEz3 .ez3-advrow',
      route: 'nothing needs it any more - same retirement, and this one was already hidden as the duplicate door',
      why: 'the second door with the same label, which is the b581 defect the owner named weeks ago' },
    { sel: '#visitView #emrCard',
      route: 'dock > Tools - and the same structured fields ride the Review destination, which reads the send path own plan (#mlsReviewPanel)',
      why: 'a read-only paste-into-your-EMR table is not part of writing or sending this note; measured 390x423 behind the door' },
    { sel: '#visitView #outcomesCard',
      route: 'dock > Tools - pain and function scores are per-visit data entry, not a step in the note',
      why: 'measured 1216x253 behind the door; nothing in the record/generate/review/sign/send ladder needs it' }
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
    'body.' + BODY + ':not(.' + PTMORE + ') #patientsView .mlsfhpdf-btn,' +
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
    /* b729 (phone audit B2): :not([hidden]) cannot see a display:none from
       another layer — on the phone the whole lane is CSS-hidden, this rule
       still matched, and the doctor had NO transcript anywhere. Phone mode
       is excluded outright: there the engine card is the only transcript. */
    'body.' + BODY + ':not(.mls-phone) #visitView #mlsEz3Body:has(.ez3fl-record:not([hidden]) #ez3flTranscript:not([hidden])) .ez3-transcript-card{display:none!important}',

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
       shortcuts" chip the engine already renders.
       ONE EXCEPTION, and it is an owner order (2026-07-26): "make sure the op
       notes button is easily accessible." vf-1.0.0 folded the whole .ez3-row2,
       and the op-note control lives in it - so shipping that fold put op notes
       two actions away on every visit state. It now stays OUT of the fold: the
       row survives only when it carries the op-note chip, and inside that row
       only the op-note chip is shown. Everything else still folds. */
    'body.' + BODY + ':not(.' + TOOLS + ') #visitView #mlsEz3Body .ez3-row2:not(:has(#ez3Prep)):not(:has(#ez3Prep2)),' +
    'body.' + BODY + ':not(.' + TOOLS + ') #visitView #ez3StyleChips{display:none!important}',
    'body.' + BODY + ':not(.' + TOOLS + ') #visitView #mlsEz3Body .ez3-row2 > *:not(#ez3Prep):not(#ez3Prep2){display:none!important}',
    /* ...and it is unmissable rather than merely present. Bigger than the quiet
       chips beside it, under the state hero, never competing with it. */
    'body.' + BODY + ' #visitView #ez3Prep,' +
    'body.' + BODY + ' #visitView #ez3Prep2{display:inline-flex!important;align-items:center;gap:8px;' +
      'min-height:44px!important;padding:11px 18px!important;font-size:14px!important;font-weight:700!important;' +
      'opacity:1!important;' +
      /* CAUGHT IN THE DARK SCREENSHOT, NOT IN THE NUMBERS. The census said
         149x44 and rendering, which is true and was not the question the owner
         asked: in dark theme the chip drew as a faint outline on a dark card -
         present, correctly sized, and effectively invisible. "Easily
         accessible" is not a rect. Both themes now get an explicit surface,
         through the tokens b681 introduced rather than literals. */
      'background:var(--card,#fff)!important;color:var(--ink,#1A211C)!important;' +
      'border:1px solid var(--line,#D9D6CD)!important;' +
      'box-shadow:0 1px 2px rgba(20,33,28,.06)!important}',
    'body.' + BODY + ' #visitView #ez3Prep:hover,' +
    'body.' + BODY + ' #visitView #ez3Prep2:hover{background:var(--soft,#F4F2EC)!important}',

    /* The calm shell captions the secondary row "GET THE DAY READY" through a
       ::before on .ez3-row2:has(#ez3Change). With the fold in place that row
       now carries ONE control - the op-note chip - so the caption describes a
       group that is not there any more. A heading over a single button is
       chrome explaining chrome; the button already says what it does. */
    'body.' + BODY + ':not(.' + TOOLS + ') #visitView #mlsEz3Body .ez3-row2::before{content:""!important;display:none!important}',

    /* The shortcuts chip is the route back, so it is never the thing that
       disappears -- and it reads as the quiet secondary it is. */
    'body.' + BODY + ' #visitView #ez3QToolsToggle,' +
    'body.' + BODY + ' #visitView #ez3flToolsToggle{display:inline-flex!important;opacity:.85}',
    'body.' + BODY + ' #visitView #ez3QToolsToggle:hover,' +
    'body.' + BODY + ' #visitView #ez3flToolsToggle:hover{opacity:1}',

    /* The canonical in-visit routes (Copilot Voice / MLS Assistant / Dictate)
       stay exactly where the owner put them -- quiet chips that never compete
       with the hero. This only guarantees they cannot grow into it. */
    'body.' + BODY + ' #visitView .ez3fl-quick .ez3fl-qchip{font-size:12.5px;font-weight:600;box-shadow:none}',

    /* ================= THE ADVANCED VISIT WORKSPACE IS RETIRED =============
     *
     * Owner, 2026-07-26: "get rid of and completely rework the advanced visit
     * workspace from scratch."
     *
     * WHAT IT WAS. One button - "Advanced visit workspace" - opened a hidden
     * second screen holding #noteCard, #emrCard and #outcomesCard. MEASURED on
     * the running page with a REAL note loaded through loadRecordIntoEditor
     * (the state this repo's own memory records as never having been measured):
     *
     *   #noteCard        390x3143      <- three thousand pixels behind a door
     *   #emrCard         390x423
     *   #outcomesCard   1216x253
     *   #pushAllEmrBtn   192x37        <- the send control, inside #noteCard
     *
     * The pattern has been wrong for weeks in ways that were each fixed
     * separately: two doors with the same label (b581), five sessions measuring
     * the city behind it at rect 0x0 and calling it dead weight, and the review
     * control coming to rest under the corner bubble (b669). The defect none of
     * those fixed is the door itself. A doctor with a generated note is not
     * doing something "advanced"; the note IS the state.
     *
     * WHAT IT IS NOW. There is no door and no second screen.
     *   - #noteCard surfaces on STATE - a real note exists - so it arrives as
     *     the primary content of the state the doctor is already in.
     *   - #emrCard and #outcomesCard leave the visit entirely and answer to
     *     Tools, because neither is part of writing or sending this note.
     *   - #captureCard stays hidden unconditionally, exactly as before. That
     *     was never an "advanced" surface, it is the duplicate raw record and
     *     generate lane, and the clinical-action gate exists to keep it closed.
     *
     * NOTHING ABOUT THE SEND PATH MOVES. #pushAllEmrBtn lives inside
     * #noteCard, and openReviewStep's own precondition is that #noteBox has
     * text - which is exactly the condition that reveals #noteCard here. The
     * door was never load-bearing for it; it only ever hid it. The gates,
     * the Lite refusal, the b669 clearance and every confirm are untouched. */
    'body.' + BODY + ' #visitView #mlsEz3 .ez3fl-openws,' +
    'body.' + BODY + ' #visitView #mlsEz3 .ez3-advrow{display:none!important}',
    'body.' + BODY + '.' + NOTE + ' #visitView #noteCard{display:block!important}',
    'body.' + BODY + ' #visitView #emrCard,' +
    'body.' + BODY + ' #visitView #outcomesCard{display:none!important}'
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
  /* A REAL note, read off the canonical field the send path itself reads.
     openReviewStep refuses unless #noteBox has text; this is the same test, so
     "the note is on screen" and "the note can be sent" can never disagree. */
  function noteLive() {
    var nb = $('noteBox');
    return !!(nb && String(nb.value || '').trim().length);
  }
  function sync() {
    var b = document.body; if (!b) return;
    b.classList.toggle(PTMORE, ptMoreOpen());
    b.classList.toggle(TOOLS, toolsOpen());
    b.classList.toggle(NOTE, noteLive());
  }

  /* The note arrives without a click, so the two disclosure listeners cannot
     see it. #noteBox is a textarea: setting .value mutates no DOM, so there is
     nothing to observe on the value itself. What the app DOES write is
     #noteBox's inline style - it ships display:none in the markup and is
     revealed when a note is really generated - and that IS an attribute
     mutation. MEASURED with loadRecordIntoEditor: the style attribute is
     rewritten ("display: none; box-sizing: border-box; max-height: 560px;
     height: 120px; overflow-y: hidden") on the same turn the value lands.
     So: one observer, on ONE element, attributes only, coalesced into a frame,
     plus the ordinary input event for hand edits. No timer. */
  var noteObs = null, noteFrame = 0;
  function scheduleSync() {
    if (noteFrame) return;
    noteFrame = safe(function () {
      return window.requestAnimationFrame(function () { noteFrame = 0; safe(sync); });
    }, 0);
    if (!noteFrame) safe(sync);
  }
  function watchNote() {
    if (noteObs) return;
    var nb = $('noteBox'); if (!nb) return;
    noteObs = safe(function () {
      var o = new MutationObserver(scheduleSync);
      o.observe(nb, { attributes: true, attributeFilter: ['style', 'class'] });
      return o;
    }, null);
  }
  function onNoteInput(ev) {
    var t = ev && ev.target;
    if (!t || !t.id) return;
    /* #noteBox is the canonical field; #ez3Note and #ez3flNote mirror into it */
    if (t.id !== 'noteBox' && t.id !== 'ez3Note' && t.id !== 'ez3flNote') return;
    scheduleSync();
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
    if (!listening) {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('input', onNoteInput, true);
      listening = true;
    }
    watchNote();
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
      try {
        if (listening) {
          document.removeEventListener('click', onDocClick, true);
          document.removeEventListener('input', onNoteInput, true);
          listening = false;
        }
      } catch (e) {}
      try { if (noteObs) noteObs.disconnect(); } catch (e) {}
      noteObs = null;
      try { if (noteFrame) window.cancelAnimationFrame(noteFrame); } catch (e) {}
      noteFrame = 0;
      try { document.body.classList.toggle(NOTE, false); } catch (e) {}
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
  setTimeout(function () { wrapToggle(); wrapRenderProfile(); markPrimary(); watchNote(); sync(); }, 1500);
  setTimeout(function () { wrapToggle(); wrapRenderProfile(); markPrimary(); watchNote(); sync(); }, 4000);
  setTimeout(function () { wrapToggle(); wrapRenderProfile(); markPrimary(); watchNote(); sync(); }, 9000);
})();
