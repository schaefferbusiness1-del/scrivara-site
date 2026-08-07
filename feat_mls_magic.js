/* =========================================================================
 * MLS Scribe — THE MOMENTS  (__mlsMagic) mg-1.1.0   2026-07-29
 *
 * OWNER: "really just make the site feel majical".
 *
 * Magic is not more motion. mo-1.0.0 owns the Copilot ring, pe-1.0.0 owns the
 * everyday entrances and press feedback. This layer owns the handful of MOMENTS
 * that carry meaning — the instants where the app should feel like it noticed
 * what just happened:
 *
 *   1. A NOTE ARRIVES.  The note card lifts in as though authored, not pasted.
 *      The card CHROME only — never the clinical text he is about to read, and
 *      never a typewriter effect on a medical record.
 *   2. SOMETHING COMPLETES.  A signature, a verified chart, a finished pull get
 *      a check that DRAWS ITSELF (stroke-dashoffset on an existing glyph) and a
 *      single dignified settle. No confetti; this is a medical record.
 *   3. A STAGE ADVANCES.  The visit rail's current dot gets one soft pulse so
 *      progress is felt, not just displayed.
 *   4. WAITING.  A shimmer that travels by TRANSFORM across a placeholder,
 *      instead of a spinner that says nothing about progress.
 *   5. THE PATIENT CHANGES.  The existing banner content crossfades, so a
 *      switch reads as deliberate rather than as a flicker.
 *
 * REJECTED deliberately: confetti or celebration on clinical completion (wrong
 * register for a medical record); any typewriter/streaming effect on note text
 * (he must be able to read and trust it instantly); parallax or scroll-linked
 * motion (nausea risk, and it fights a doctor scanning a chart); sound.
 *
 * CONSTRAINTS honoured: transform/opacity/stroke-dashoffset only; every moving
 * rule is registered in MOMENTS so the reduced-motion block is GENERATED from
 * it; nothing animates clinical text; everything stands down while recording or
 * while a note is live; no timers, no rAF, no observers; decorative layers are
 * pointer-events:none; dark theme inherits because only opacity/transform and
 * currentColor are used.
 *
 * Idempotent; additive. Revert: window.__mlsMagic.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsMagic) return; } catch (e) { return; }

  var STYLE_ID = 'mlsMagicCss';
  var api = { version: 'mg-1.1.0', installed: true };
  window.__mlsMagic = api;
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  var D1 = 'var(--mls-dur-1,120ms)';
  var D2 = 'var(--mls-dur-2,200ms)';
  var D3 = 'var(--mls-dur-3,300ms)';
  var D4 = 'var(--mls-dur-4,420ms)';
  var EO = 'var(--mls-ease-out,cubic-bezier(0.22,1,0.36,1))';

  /* Each entry: [selector, declarations]. The off-switch is derived from this. */
  var MOMENTS = [
    /* 1. the note arriving — chrome only */
    ['body.mls-note-live #noteCard',
     'animation:mgArrive ' + D4 + ' ' + EO + ' both'],

    /* 2. completion - one dignified settle.
       `.mg-drawn` (a check drawing itself via stroke-dashoffset) was REMOVED on
       2026-07-29: nothing ever added the class, and the visit stage rail already
       draws its own SVG check, so there was no element left for it to drive. A
       rule that cannot fire is deleted, not kept for the look of it. */
    ['.mg-settle',
     'animation:mgSettle ' + D3 + ' ' + EO + ' both'],

    /* 3. a stage advancing — one soft pulse on the current dot */
    ['#mlsStages .st.now .dot',
     'animation:mgPulse ' + D4 + ' ' + EO + ' both'],

    /* 4. waiting — a shimmer that TRAVELS, never a background-position tween.
       RETARGETED 2026-07-29: this used to require a `.mg-wait` class that NOTHING
       in the repo ever added, so the moment could not fire. `.pp-wait` is a class
       the pull panel really emits for a patient being read right now, so the
       shimmer now lands on the one place in the app that genuinely means
       "waiting". A moment keyed to a class no writer sets is decoration, not a
       feature. */
    ['#mlsPullProgPanel .pp-wait',
     'position:relative;overflow:hidden'],
    ['#mlsPullProgPanel .pp-wait::after',
     'content:"";position:absolute;inset:0;pointer-events:none;' +
     'background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);' +
     'transform:translateX(-100%);animation:mgShimmer 1.4s linear infinite'],

    /* 5. the banner patient changing — crossfade the EXISTING content.
       RETARGETED 2026-07-29 after a read-only audit caught TWO errors here, both
       mine and both the defect class this module exists to avoid:
         - `#patientLabel` is a text INPUT (ScribeFlow.html:3020), not the banner.
           Fading a form field the doctor may be typing in is wrong on every axis.
         - `.mls-pt-banner-name` existed in NO file except this one. A class only
           its own stylesheet mentions is the definition of dead CSS.
       `#patientBarInner` is the element renderPatientBar actually writes
       (ScribeFlow.html:12213 -> getElementById('patientBarInner')), so the
       crossfade now lands on the content that genuinely changes. */
    ['#patientBarInner',
     'transition:opacity ' + D2 + ' ' + EO],
    ['body.mg-pt-swap #patientBarInner',
     'opacity:.35']
  ];

  var KEYFRAMES = [
    '@keyframes mgArrive{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}',
    '@keyframes mgSettle{0%{transform:scale(.94);opacity:.6}60%{transform:scale(1.01)}100%{transform:none;opacity:1}}',
    '@keyframes mgPulse{0%{transform:scale(1)}45%{transform:scale(1.18)}100%{transform:scale(1.15)}}',
    '@keyframes mgShimmer{to{transform:translateX(100%)}}'
  ].join('\n');

  /* Clinical text is never animated by this module, and every moment stands
     down while capture is live or a note is on screen being read. */
  var GUARDS =
    '#noteBox, #transcript, textarea, [contenteditable="true"], .mlsf-note, .mlsf-note *' +
    '{animation:none!important}' +
    'body.mls-recording .mg-settle,' +
    'body.mls-recording #mlsStages .st.now .dot, body.mls-recording #mlsPullProgPanel .pp-wait::after' +
    '{animation:none!important}';

  /* =========================================================================
     2026-07-29 — SIX MORE MOMENTS, EACH WITH A CITED TRIGGER.
     Owner: "make apple like magical animatioons all over ... to make thiungs
     ifelel intuitive" / "at least 5 new amazing anumations".

     The rule this module learned the hard way: a keyframe with no trigger is
     decoration that animates nothing. So every entry names the exact thing that
     fires it, and tests/magic-moments-actually-fire.test.js dispatches that thing
     and asserts the class lands on the real node.

     WHY THESE SIX. Each answers a question a doctor is actually asking:
       did my pick land?           -> the applied template commits
       which one am I reading?     -> the preview sheet arrives FROM the list
       did my upload save?         -> the new template lands in the library
       will it take this file?     -> the drop zone leans in
       what did I just choose?     -> the mode tile confirms
       is this patient done?       -> the saved row settles
     Motion that answers a question is intuition; motion that does not is noise on
     a medical record, and was rejected. */
  var MX = [
    /* 1. THE APPLIED TEMPLATE COMMITS. Trigger: buildTplRail writes
          .opr-tpl-item.on (feat_mls_opnote_room.js) on every apply. */
    ['.opr-tpl-item.on', 'animation:mgxCommit ' + D3 + ' ' + EO + ' both'],
    /* the armed state leans forward so "click again to switch" is felt, not read */
    ['.opr-tpl-item.armed', 'animation:mgxArm ' + D2 + ' ' + EO + ' both'],

    /* 2. THE PREVIEW SHEET ARRIVES. Trigger: the renderTplDetail wrapper below. */
    ['#tplDetail.mgx-arrive', 'animation:mgxSheet ' + D3 + ' ' + EO + ' both'],

    /* 3. A TEMPLATE LANDS IN THE LIBRARY. Trigger: the saveTemplateFromForm
          wrapper below. The list settles ONCE, not per row - renderTemplateList
          rebuilds by innerHTML, so a per-row stagger would replay on every
          keystroke in the search box. That is the nausea case. */
    ['#tplList.mgx-landed', 'animation:mgxSettleIn ' + D4 + ' ' + EO + ' both'],

    /* 4. THE DROP ZONE LEANS IN. Trigger: a real hover. _tplDragOver owns the
          COLOUR inline (ScribeFlow.html:16320), so only transform is ours -
          animating colour here would fight the drag feedback. */
    ['#tplDropZone, #tplMultiDrop', 'transition:transform ' + D2 + ' ' + EO],
    ['#tplDropZone:hover, #tplMultiDrop:hover', 'transform:scale(1.006)'],

    /* 5. THE MODE TILE CONFIRMS. Trigger: aria-pressed, written by buildTplMode
          on every click. */
    ['.opr-tplmode[aria-pressed="true"]', 'animation:mgxPick ' + D3 + ' ' + EO + ' both'],

    /* 6. A PATIENT'S CHART LANDED. Trigger: .pp-ok, emitted by the pull panel's
          own row renderer for a row that saved. */
    ['#mlsPullProgPanel .pp-ok', 'animation:mgxDone ' + D3 + ' ' + EO + ' both']
  ];

  var MX_KEYFRAMES = [
    /* a commit is a short confident settle - never a bounce on a medical record */
    '@keyframes mgxCommit{0%{transform:scale(.985)}55%{transform:scale(1.004)}100%{transform:none}}',
    '@keyframes mgxArm{from{transform:none}to{transform:translateX(2px)}}',
    /* the sheet enters from the LEFT because that is where the list is - the
       direction IS the message: it says where this content came from */
    '@keyframes mgxSheet{from{opacity:0;transform:translateX(-6px) scale(.995)}to{opacity:1;transform:none}}',
    '@keyframes mgxSettleIn{from{opacity:.55;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '@keyframes mgxPick{0%{transform:scale(.99)}60%{transform:scale(1.006)}100%{transform:none}}',
    '@keyframes mgxDone{from{opacity:.4;transform:scale(.96)}to{opacity:1;transform:none}}'
  ].join('\n');

  /* =========================================================================
     mg-1.1.0 (owner 2026-08-02: "add even more pretty animations ... make the
     site feel like magic") — THE OP-NOTE SESSION, five more moments. Same law
     as MX: every entry cites the exact thing that fires it, every answer is a
     FACT the app can back, and the shared build loop generates the
     reduced-motion off-switch. Observers stay banned; the two JS triggers are
     wrap-and-emit with a state fact-check, the rest are CSS-only triggers
     (hover, and the display none->shown restart the menus' own open code
     performs).
       did my draft produce blanks?  -> the Fields box is born (onf writes
                                        .mgx2-born at CREATE, once per draft)
       did the machine finish/save?  -> #opPrepStatus settles (wraps below,
                                        fact-checked on _genSeq / _noteId)
       did my pin take?              -> the field row confirms (onf writes
                                        .mgx2-pinned on the explicit click)
       which row am I on?            -> .pt-item leans in on hover
       what just opened?             -> the dock menus arrive from their button
     The saved NOTE itself is never animated: a drafted op note is clinical
     text, and the GUARDS' spirit covers its container too — confirmation
     lives on the status line, which is chrome. */
  var MX2 = [
    ['.onf-fillbox.mgx2-born', 'animation:mgx2Born ' + D3 + ' ' + EO + ' both'],
    ['#opPrepStatus.mgx2-good', 'animation:mgx2Good ' + D3 + ' ' + EO + ' both'],
    ['.onf-field.mgx2-pinned', 'animation:mgx2Pin ' + D2 + ' ' + EO + ' both'],
    ['#ptList .pt-item', 'transition:transform ' + D1 + ' ' + EO],
    ['#ptList .pt-item:hover', 'transform:translateY(-1px)'],
    ['#mlsToolsMenu, #mlsAccountPopover', 'animation:mgx2Menu ' + D2 + ' ' + EO + ' both']
  ];
  var MX2_KEYFRAMES = [
    '@keyframes mgx2Born{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
    '@keyframes mgx2Good{0%{transform:scale(.985);opacity:.7}60%{transform:scale(1.01)}100%{transform:none;opacity:1}}',
    '@keyframes mgx2Pin{0%{transform:scale(.995)}60%{transform:scale(1.004)}100%{transform:none}}',
    /* menus drop 4px FROM the button that owns them - direction is provenance */
    '@keyframes mgx2Menu{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
  ].join('\n');

  function build() {
    var out = [KEYFRAMES, MX_KEYFRAMES, MX2_KEYFRAMES], kill = [];
    /* MOMENTS, MX and MX2 go through the SAME loop, so a rule added to any
       table cannot ship without its generated reduced-motion off-switch. The
       filter matches rules that turn motion ON: `animation:none` is an
       off-switch, not an animation, and counting those was a real false
       positive earlier today. */
    MOMENTS.concat(MX).concat(MX2).forEach(function (m) {
      out.push(m[0] + '{' + m[1] + '}');
      if (/animation\s*:\s*(?!none)[a-zA-Z]/.test(m[1]) ||
          /transition\s*:\s*(?!none)[a-zA-Z-]+\s/.test(m[1])) kill.push(m[0]);
    });
    out.push(GUARDS);
    out.push('@media (prefers-reduced-motion: reduce){' +
      kill.join(',') + '{animation:none!important;transition:none!important}' +
      'body.mls-note-live #noteCard{opacity:1!important;transform:none!important}' +
      '#mlsPullProgPanel .pp-wait::after{animation:none!important;opacity:0!important}' +
      '#mlsStages .st.now .dot{transform:scale(1.15)!important}' +
      '}');
    return out.join('\n');
  }
  api.css = build;

  safe(function () {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = build();
    (document.head || document.documentElement).appendChild(st);
  });

  /* =========================================================================
     2026-07-29 — THE MOMENTS ARE WIRED. Owner: "WHERE IS ALL THE MAJIC".

     He was right and the answer was embarrassing: this module shipped a
     stylesheet and NOTHING ELSE. A repo-wide sweep found ZERO writers for every
     class it keys off — `.mg-drawn` 0, `.mg-settle` 0, `.mg-wait` 0,
     `body.mg-pt-swap` 0 (its only mention was the remove() in revert), and
     `body.mls-note-live` 0 despite FOUR modules styling on it. Five moments,
     none of which could ever fire. It was dead CSS.

     Now it listens to events the app REALLY dispatches, verified by grep:
       mls:generation-complete  — ScribeFlow.html:19484, :19487, :19543
       mls:active-patient-changed
     No polling, no observer, no rAF. Two window listeners, both removed by
     revert(). The transient swap class is cleared on `transitionend` — the
     animation's own completion — with ONE bounded fallback timeout in case
     reduced-motion means no transition ever runs, so the class cannot latch.
     A single one-shot is not the timer LOOP the header forbids.

     body.mls-note-live is the valuable one: setting it truthfully also makes the
     stand-downs in three other modules real for the first time. */
  var listeners = [];
  var swapTimer = 0;
  function on(target, name, fn) {
    safe(function () { target.addEventListener(name, fn, false); listeners.push([target, name, fn]); });
  }

  function noteLive(yes) {
    safe(function () { document.body.classList.toggle('mls-note-live', !!yes); });
  }

  /* A note just arrived: the card lifts in, and the whole app now knows a note is
     on screen. */
  /* mls:generation-complete DOES NOT MEAN A NOTE ARRIVED. An audit traced its
     three dispatch sites and it means generation SETTLED - it fires on the
     no-API-key refusal (ScribeFlow.html:19497), on the offline-example path
     (:19501), and from the `finally` block of the real generate (:19553), which
     runs on timeout and on error too. Celebrating that unconditionally is the
     same lie as a toast over a silent failure, and this module was congratulating
     the doctor on a note that did not exist.
     So the moment now asks the DOM whether there is actually a note. That is a
     fact, not a claim - and an animation should never assert more than the app
     can back. */
  function haveNote() {
    return safe(function () {
      var box = document.getElementById('noteBox');
      if (box && String(box.value == null ? '' : box.value).trim().length > 20) return true;
      var card = document.getElementById('noteCard');
      return !!(card && String(card.textContent || '').trim().length > 20);
    }, false);
  }

  on(window, 'mls:generation-complete', function () {
    if (!haveNote()) { noteLive(false); return; }   /* settled, but empty-handed */
    noteLive(true);
    safe(function () {
      var card = document.getElementById('noteCard');
      if (!card) return;
      /* restart the entrance even if the class is already there */
      card.classList.remove('mg-settle');
      void card.offsetWidth;
      card.classList.add('mg-settle');
    });
  });

  /* The patient changed: crossfade what the banner already shows, and stand the
     note-live state down because the new patient has no note yet. */
  on(window, 'mls:active-patient-changed', function () {
    noteLive(false);
    safe(function () {
      var b = document.body;
      b.classList.add('mg-pt-swap');
      var clear = function () { safe(function () { b.classList.remove('mg-pt-swap'); }); };
      var label = document.getElementById('patientLabel');
      if (label) safe(function () { label.addEventListener('transitionend', clear, { once: true }); });
      if (swapTimer) clearTimeout(swapTimer);
      swapTimer = setTimeout(clear, 700);   /* one bounded fallback, not a loop */
    });
  });

  /* WRAP-AND-EMIT. The Templates surface dispatches no events of its own, and an
     observer is banned here (this app has been measured wedging the main thread
     for minutes). So we wrap its own render functions - the idiom this codebase
     already uses everywhere - and emit the moment after the real work returns.
     That is a genuine trigger: it fires exactly when the thing it describes
     happens, costs one call, and unwraps cleanly on revert. */
  var wrapped = [];
  function wrapEmit(name, nodeId, cls) {
    safe(function () {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__mgxWrap) return;
      var w = function () {
        var r = orig.apply(this, arguments);
        safe(function () {
          var el = document.getElementById(nodeId);
          if (!el) return;
          /* remove -> reflow -> add, so the animation REPLAYS on a second
             selection instead of sitting there already-classed */
          el.classList.remove(cls);
          void el.offsetWidth;
          el.classList.add(cls);
        });
        return r;
      };
      w.__mgxWrap = true;
      w.__mgxOrig = orig;
      window[name] = w;
      wrapped.push(name);
    });
  }
  function wireTemplatesMoments() {
    wrapEmit('renderTplDetail', 'tplDetail', 'mgx-arrive');
    wrapEmit('saveTemplateFromForm', 'tplList', 'mgx-landed');
  }
  wireTemplatesMoments();
  /* Templates loads late, so re-attempt when a view changes - event-driven, never
     a poll, and idempotent because wrapEmit refuses an already-wrapped function. */
  on(window, 'mls:view-changed', function () { safe(wireTemplatesMoments); });

  /* mg-1.1.0 — the status line settles when the op-note machinery ACTUALLY
     delivered, never merely when it ran. Both wraps fact-check row state the
     same way the note moment asks haveNote(): opPrepGenerateOne resolves and
     the row's _genSeq moved -> a draft landed; opPrepSave returns and the row
     carries a _noteId -> the save landed. Every failure path in both
     functions returns before those facts become true, so the moment cannot
     congratulate a refusal (the b500 lesson, and this module's own
     generation-complete lesson, applied in advance). */
  function statusGood() {
    safe(function () {
      var el = document.getElementById('opPrepStatus');
      if (!el || !el.offsetWidth) return;
      el.classList.remove('mgx2-good');
      void el.offsetWidth;
      el.classList.add('mgx2-good');
    });
  }
  function wrapDraftMoment() {
    safe(function () {
      var orig = window.opPrepGenerateOne;
      if (typeof orig !== 'function' || orig.__mgxWrap) return;
      var w = function (i) {
        var pre = safe(function () { return ((window._opPrep || [])[i] || {})._genSeq || 0; }, 0);
        var r = orig.apply(this, arguments);
        var check = function () {
          var post = safe(function () { return ((window._opPrep || [])[i] || {})._genSeq || 0; }, 0);
          if (post > pre) statusGood();
        };
        if (r && typeof r.then === 'function') r.then(check, function () {});
        else safe(check);
        return r;
      };
      w.__mgxWrap = true; w.__mgxOrig = orig;
      window.opPrepGenerateOne = w;
      wrapped.push('opPrepGenerateOne');
    });
    safe(function () {
      var orig = window.opPrepSave;
      if (typeof orig !== 'function' || orig.__mgxWrap) return;
      var w = function (i) {
        var r = orig.apply(this, arguments);
        safe(function () {
          if (((window._opPrep || [])[i] || {})._noteId) statusGood();
        });
        return r;
      };
      w.__mgxWrap = true; w.__mgxOrig = orig;
      window.opPrepSave = w;
      wrapped.push('opPrepSave');
    });
  }
  wrapDraftMoment();
  on(window, 'mls:view-changed', function () { safe(wrapDraftMoment); });

  api.moments = function () {
    return { rules: MOMENTS.length + MX.length + MX2.length, wrapped: wrapped.slice() };
  };

  api.revert = function () {
    safe(function () {
      wrapped.forEach(function (n) {
        safe(function () {
          if (window[n] && window[n].__mgxWrap && window[n].__mgxOrig) window[n] = window[n].__mgxOrig;
        });
      });
      wrapped.length = 0;
    });
    safe(function () {
      ['tplDetail', 'tplList'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.classList.remove('mgx-arrive'); el.classList.remove('mgx-landed'); }
      });
    });
    safe(function () { if (swapTimer) clearTimeout(swapTimer); swapTimer = 0; });
    safe(function () {
      listeners.forEach(function (l) { safe(function () { l[0].removeEventListener(l[1], l[2], false); }); });
      listeners.length = 0;
    });
    safe(function () { document.body.classList.remove('mls-note-live'); });
    safe(function () {
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    });
    safe(function () {
      ['mg-settle', 'mgx2-good', 'mgx2-born', 'mgx2-pinned'].forEach(function (c) {
        var els = document.querySelectorAll('.' + c);
        for (var i = 0; i < els.length; i++) els[i].classList.remove(c);
      });
      document.body.classList.remove('mg-pt-swap');
    });
    safe(function () { delete window.__mlsMagic; });
  };
})();
