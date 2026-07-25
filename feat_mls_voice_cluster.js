/* MLS Voice Cluster — vc-1.0.0
 *
 * The owner: "3 BUBBLES GET TURNED INTO ONE BUBBLE WITH ALL FUNCTIONALITY AND
 * BEAUTIFUL AI."
 *
 * The bottom-left carried three controls at three different visual weights: a
 * violet gradient pill (Copilot Voice), a green gradient pill (MLS Assistant),
 * and a plain text link (Dictate). Three weights for three peers reads as
 * accumulated rather than designed.
 *
 * ONE BUBBLE THAT EXPANDS — NEVER ONE THAT DECIDES.
 * ------------------------------------------------
 * This is the whole design constraint, and it comes from a clinical guarantee,
 * not taste:
 *
 *   - Copilot Voice and Dictate are DIFFERENT RECOGNIZERS under an explicit
 *     one-recognizer truce (mls-connect.js F11, :21491). They must never both
 *     be live.
 *   - The app ships a help entry (:30416) whose entire purpose is explaining
 *     that MLS Assistant, Copilot Voice and MLS Assist are three DIFFERENT
 *     things: Assistant = chat panel, Copilot Voice = voice control,
 *     Dictate = transcript input.
 *
 * So a single button that infers which one you meant would silently start the
 * wrong recognizer mid-visit and erase a distinction the product documents.
 * This module renders one face that FANS OUT into the three, each keeping its
 * own name. Nothing is merged except the chrome.
 *
 * IT OWNS NO BEHAVIOUR. Every action clicks the real control and returns. The
 * truce, the recognizer lifecycle, and every failure path stay where they are.
 * This module only ever:
 *   - reads state off the real controls to mirror it, and
 *   - clicks them.
 * If it is removed, the three originals are visible again and nothing else
 * changes. window.__mlsVoiceCluster.revert() does exactly that at runtime.
 *
 * WHICH ONE IS LIVE IS ALWAYS VISIBLE. Collapsing three chips into one is
 * exactly where "is my mic hot?" could get lost, so the face carries the live
 * name and a pulsing dot whenever any recognizer is running, and the fan marks
 * the live item with aria-pressed. A closed bubble never hides a hot mic.
 *
 * The originals are hidden BY CLASS, never inline: available() tests inline
 * display, so a class-hide keeps them reachable from the Calm Shell's Tools
 * menu while an inline hide would silently remove three features.
 *
 * Motion is transform/opacity only — no property here can trigger layout — and
 * every bit of it is disabled under prefers-reduced-motion.
 */
(function () {
  'use strict';

  var W = window, D = document;
  if (W.__mlsVoiceCluster) return;

  var VERSION = 'vc-1.0.0';
  var STYLE_ID = 'mlsVcStyle';
  var ROOT_ID = 'mlsVoiceCluster';
  var BODY_ON = 'mls-voice-cluster';

  /* The three peers, in the order a clinician reaches for them during a visit.
     `id` is the canonical control this item clicks — never a re-implementation. */
  var ITEMS = [
    { key: 'voice', id: 'mlsCopVoiceBtn', label: 'Copilot Voice', hint: 'Hands-free commands',
      glyph: '<circle cx="12" cy="12" r="3.2"/><path d="M12 5.2v2M12 16.8v2M18.8 12h-2M7.2 12h-2"/>' },
    { key: 'assist', id: 'mlsAsstFab', label: 'MLS Assistant', hint: 'Ask in chat',
      glyph: '<path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z"/>' },
    { key: 'dictate', id: 'mlsDaDock', label: 'Dictate', hint: 'Speak into the note',
      glyph: '<rect x="9" y="3.4" width="6" height="10.2" rx="3"/><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.8V21"/>' }
  ];

  function $(id) { return D.getElementById(id); }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  /* A control the app still offers. Mirrors the Calm Shell's rule: an inline
     display:none is the app gating a feature off, and a gated control must
     never be proxied. Our own class-hide is on the ANCESTOR, so it never
     inline-hides these and never makes them look unavailable. */
  function available(el) {
    if (!el) return false;
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    if (el.disabled) return false;
    if (el.style && el.style.display === 'none') return false;
    return true;
  }

  function liveItems() {
    return ITEMS.map(function (it) {
      var el = $(it.id);
      return available(el) ? { def: it, el: el } : null;
    }).filter(Boolean);
  }

  /* The visit lane's own copies of the three tools. When these are genuinely on
     screen they are the canonical controls and the cluster must get out of the
     way — that part was always right. */
  var TWINS = ['ez3flCopilotVoice', 'ez3flAssistant', 'ez3flDictate'];

  /* Should the cluster stand down?
   *
   * b651 answered this with a CSS rule keyed on body.mls-top-voice-tools,
   * reasoning "hide under the same class the originals hide under, so the two
   * surfaces cannot drift." That class can LIE. Measured on the owner's live
   * signed-in tab at b653, with the class set:
   *
   *   #mlsCopVoiceBtn / #mlsAsstFab / #mlsDaDock   display:none  (the class)
   *   #ez3flCopilotVoice / #ez3flAssistant / #ez3flDictate   display:none, 0x0
   *   #mlsVoiceCluster                              display:none  (my rule)
   *
   * Three routes to Copilot Voice, MLS Assistant and Dictate, all closed. The
   * class asserted the top lane owned them while the top lane rendered nothing.
   *
   * So ask the question the class was standing in for, the way the app already
   * asks it in topLaneIsVisible() (mls-connect.js ~:6447): does a twin actually
   * have layout? Geometry cannot lie the way a class can. If no twin is on
   * screen the cluster stays up, and the doctor keeps all three tools. */
  function standDown() {
    for (var i = 0; i < TWINS.length; i++) {
      var t = $(TWINS[i]);
      if (!t) continue;
      var cs = getComputedStyle(t);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = t.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  }

  /* Is this control currently running? Read the app's own signals — never a
     private flag of ours, which could disagree with the truce. */
  function isOn(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('aria-pressed') === 'true') return true;
    if (el.classList && (el.classList.contains('on') || el.classList.contains('listening'))) return true;
    return false;
  }

  /* --------------------------------------------------------------- styles */
  function css() {
    if ($(STYLE_ID)) return;
    var s = D.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* the originals step aside — by class, so they stay reachable in Tools */
      'html body.' + BODY_ON + ' #mlsCopVoiceBtn,',
      'html body.' + BODY_ON + ' #mlsAsstFab,',
      'html body.' + BODY_ON + ' #mlsDaDock{display:none!important;}',

      /* Standing down is decided at RUNTIME by real twin geometry, not by this
         class. See standDown() — the class can assert that the top lane owns
         these controls while the top lane is not rendering them, and trusting it
         left a doctor with three closed doors and no voice tools at all. */
      '#' + ROOT_ID + '.standdown{display:none!important;}',

      '#' + ROOT_ID + '{position:fixed;left:18px;bottom:18px;z-index:2147482000;',
      'display:flex;flex-direction:column-reverse;align-items:flex-start;gap:9px;',
      'font-family:inherit;-webkit-font-smoothing:antialiased;}',

      /* ---- the one bubble ---- */
      '#mlsVcFace{display:inline-flex;align-items:center;gap:9px;border:0;cursor:pointer;',
      'padding:12px 17px 12px 14px;border-radius:999px;min-height:48px;',
      'background:linear-gradient(135deg,#204034 0%,#2E6A4B 100%);color:#fff;',
      'font-size:14.5px;font-weight:700;font-family:inherit;letter-spacing:.01em;',
      'box-shadow:0 10px 26px -10px rgba(20,42,32,.72),0 2px 6px rgba(20,42,32,.28);',
      'transition:transform .18s cubic-bezier(.2,.7,.3,1),box-shadow .18s ease,filter .18s ease;}',
      '#mlsVcFace:hover{transform:translateY(-2px);filter:brightness(1.06);',
      'box-shadow:0 16px 34px -12px rgba(20,42,32,.78),0 3px 8px rgba(20,42,32,.3);}',
      '#mlsVcFace:active{transform:translateY(0) scale(.975);}',
      '#mlsVcFace:focus-visible{outline:3px solid #9BD5B4;outline-offset:3px;}',

      /* the mark: a soft orbit that reads as "AI" without a mascot */
      '#mlsVcFace .vc-mark{position:relative;width:22px;height:22px;flex:0 0 auto;display:block;}',
      '#mlsVcFace .vc-mark svg{width:22px;height:22px;display:block;fill:none;stroke:#fff;',
      'stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}',
      '#mlsVcFace .vc-orbit{position:absolute;inset:-3px;border-radius:50%;',
      'border:1.4px solid rgba(255,255,255,.42);border-top-color:transparent;',
      'border-bottom-color:transparent;opacity:0;}',

      /* ---- live state: never hidden by a closed bubble ---- */
      '#' + ROOT_ID + '.live #mlsVcFace{background:linear-gradient(135deg,#2E6A4B 0%,#3C8A61 100%);}',
      '#' + ROOT_ID + '.live .vc-orbit{opacity:1;animation:mlsVcOrbit 2.4s linear infinite;}',
      '#mlsVcFace .vc-dot{width:8px;height:8px;border-radius:50%;background:#7BE0AC;flex:0 0 auto;',
      'box-shadow:0 0 0 0 rgba(123,224,172,.62);display:none;}',
      '#' + ROOT_ID + '.live .vc-dot{display:block;animation:mlsVcDot 1.9s ease-out infinite;}',

      '#mlsVcCaret{width:11px;height:11px;flex:0 0 auto;opacity:.85;',
      'transition:transform .2s cubic-bezier(.2,.7,.3,1);}',
      '#' + ROOT_ID + '.open #mlsVcCaret{transform:rotate(180deg);}',

      /* ---- the fan ---- */
      '#mlsVcFan{display:flex;flex-direction:column-reverse;align-items:flex-start;gap:8px;',
      'margin:0;padding:0;list-style:none;pointer-events:none;}',
      '#' + ROOT_ID + '.open #mlsVcFan{pointer-events:auto;}',

      '.vc-item{display:inline-flex;align-items:center;gap:10px;border:1px solid #E2E6E2;cursor:pointer;',
      'padding:10px 16px 10px 12px;border-radius:999px;min-height:44px;background:#fff;color:#1A211C;',
      'font-size:13.5px;font-weight:650;font-family:inherit;text-align:left;white-space:nowrap;',
      'box-shadow:0 8px 20px -10px rgba(20,42,32,.42);',
      'opacity:0;transform:translateY(10px) scale(.94);transform-origin:left bottom;',
      'transition:opacity .2s ease,transform .24s cubic-bezier(.2,.9,.3,1),',
      'background .16s ease,border-color .16s ease;}',
      '#' + ROOT_ID + '.open .vc-item{opacity:1;transform:translateY(0) scale(1);}',
      /* staggered so the three arrive as a sequence, not a jump */
      '#' + ROOT_ID + '.open .vc-item:nth-child(1){transition-delay:.02s;}',
      '#' + ROOT_ID + '.open .vc-item:nth-child(2){transition-delay:.06s;}',
      '#' + ROOT_ID + '.open .vc-item:nth-child(3){transition-delay:.10s;}',
      '.vc-item:hover{background:#F4F6F4;border-color:#CFDAD2;}',
      '.vc-item:focus-visible{outline:3px solid #2E6A4B;outline-offset:2px;}',
      '.vc-item svg{width:19px;height:19px;flex:0 0 auto;fill:none;stroke:#2E6A4B;',
      'stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;}',
      '.vc-item .vc-hint{color:#5A655E;font-weight:500;font-size:12.5px;}',
      /* the running one is unmistakable in the fan too */
      '.vc-item[aria-pressed="true"]{background:#EAF1EE;border-color:#2E6A4B;color:#204034;}',
      '.vc-item[aria-pressed="true"] .vc-live{width:7px;height:7px;border-radius:50%;',
      'background:#2E6A4B;animation:mlsVcDot 1.9s ease-out infinite;}',

      '@keyframes mlsVcOrbit{to{transform:rotate(360deg);}}',
      '@keyframes mlsVcDot{0%{box-shadow:0 0 0 0 rgba(123,224,172,.6);}',
      '70%{box-shadow:0 0 0 7px rgba(123,224,172,0);}100%{box-shadow:0 0 0 0 rgba(123,224,172,0);}}',

      /* phones: the row must never own the last content pixels */
      /* Clear the dock. On a phone #mlsDock is the ONLY navigation and it spans
         the full width at bottom:8px (feat_mls_calm_shell.js:543). At bottom:12px
         this cluster overlapped it and won both stacking (z 2147482000 vs 920)
         and pointer events — the bubble would have eaten taps meant for Patients,
         Visit and Review.
         Standing down does not save us here: phone mode kills the ez3 twins
         (mls-connect.js:44428 `body.mls-phone .ez3fl-quick{display:none}`), so no
         twin has layout and standDown() is correctly false. The cluster is meant
         to be up on a phone — it just has to sit above the dock.
         Same clearance ScribeFlow.html:1367 already uses for #mlsA2hsCard, so
         both float above the same dock by the same rule. Static value: `bottom`
         is never transitioned here (only transform/box-shadow/filter are), so
         this animates nothing. */
      '@media (max-width:760px){#' + ROOT_ID +
      '{left:12px;bottom:calc(84px + env(safe-area-inset-bottom,0px) + var(--mls-kbd,0px));}',
      '#mlsVcFace{font-size:14px;padding:11px 15px 11px 13px;}',
      '.vc-item .vc-hint{display:none;}}',

      /* Motion is decoration here; the control must work identically without it.
         Everything above animates transform/opacity only, so switching it off
         changes nothing structural. */
      '@media (prefers-reduced-motion: reduce){',
      '#' + ROOT_ID + ' *,#' + ROOT_ID + '{animation:none!important;transition:none!important;}',
      '#' + ROOT_ID + '.open .vc-item{opacity:1;transform:none;}',
      '#mlsVcFace:hover{transform:none;}}'
    ].join('');
    (D.head || D.documentElement).appendChild(s);
  }

  /* ----------------------------------------------------------------- view */
  var root = null, face = null, fan = null, faceName = null;

  function close() {
    if (!root) return;
    root.classList.remove('open');
    if (face) face.setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if (!root) return;
    var open = root.classList.toggle('open');
    if (face) face.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var first = fan && fan.querySelector('.vc-item');
      if (first) safe(function () { first.focus(); });
    }
  }

  function build(items) {
    root = D.createElement('div');
    root.id = ROOT_ID;

    face = D.createElement('button');
    face.type = 'button';
    face.id = 'mlsVcFace';
    face.setAttribute('aria-expanded', 'false');
    face.setAttribute('aria-haspopup', 'true');
    face.setAttribute('aria-label', 'Voice and assistant');
    face.innerHTML =
      '<span class="vc-mark"><span class="vc-orbit"></span>' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.1"/>' +
      '<path d="M12 4.6v2.1M12 17.3v2.1M19.4 12h-2.1M6.7 12H4.6"/></svg></span>' +
      '<span class="vc-dot" aria-hidden="true"></span>' +
      '<span id="mlsVcName">Voice &amp; assistant</span>' +
      '<svg id="mlsVcCaret" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>';
    face.addEventListener('click', function (e) { e.preventDefault(); toggle(); });
    faceName = face.querySelector('#mlsVcName');

    fan = D.createElement('div');
    fan.id = 'mlsVcFan';
    fan.setAttribute('role', 'group');
    fan.setAttribute('aria-label', 'Voice and assistant tools');

    items.forEach(function (it) {
      var b = D.createElement('button');
      b.type = 'button';
      b.className = 'vc-item';
      b.setAttribute('data-vc', it.def.key);
      /* aria-controls names the REAL control this proxies, so assistive tech
         and any future audit can follow the proxy back to its owner. */
      b.setAttribute('aria-controls', it.def.id);
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + it.def.glyph + '</svg>' +
        '<span>' + it.def.label + '</span>' +
        '<span class="vc-hint">' + it.def.hint + '</span>' +
        '<span class="vc-live" aria-hidden="true"></span>';
      b.addEventListener('click', function (e) {
        e.preventDefault();
        /* Click the real control and get out of the way. Everything that makes
           this safe — the one-recognizer truce, mic permission, failure
           messages — lives there and must keep living there. */
        var target = $(it.def.id);
        if (target) safe(function () { target.click(); });
        close();
        setTimeout(sync, 90);
      });
      fan.appendChild(b);
    });

    root.appendChild(fan);
    root.appendChild(face);
    (D.body || D.documentElement).appendChild(root);

    D.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('open')) { close(); safe(function () { face.focus(); }); }
    });
    D.addEventListener('click', function (e) {
      if (root.classList.contains('open') && !root.contains(e.target)) close();
    });
  }

  /* --------------------------------------------------------------- mirror */
  /* Reflect the app's state; never author it. If two ever read as live at once
     that is the truce's business, not ours — we show what is true. */
  function sync() {
    if (!root) return;
    /* Re-decided every sync, because the visit lane comes and goes. Toggled by
       class on our OWN root — never an inline write, and never on the twins. */
    var down = standDown();
    if (root.classList.contains('standdown') !== down) root.classList.toggle('standdown', down);
    var liveNames = [];
    var btns = fan ? fan.querySelectorAll('.vc-item') : [];
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var def = null;
      for (var j = 0; j < ITEMS.length; j++) if (ITEMS[j].key === b.getAttribute('data-vc')) def = ITEMS[j];
      if (!def) continue;
      var on = isOn($(def.id));
      var was = b.getAttribute('aria-pressed') === 'true';
      /* write only on change — a no-op attribute write still invalidates style */
      if (on !== was) b.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) liveNames.push(def.label);
    }
    var live = liveNames.length > 0;
    if (root.classList.contains('live') !== live) root.classList.toggle('live', live);
    var name = live ? liveNames.join(' + ') : 'Voice & assistant';
    if (faceName && faceName.textContent !== name) faceName.textContent = name;
    var label = live ? (liveNames.join(' and ') + ' running. Open voice and assistant tools.')
                     : 'Voice and assistant';
    if (face && face.getAttribute('aria-label') !== label) face.setAttribute('aria-label', label);
  }

  /* ----------------------------------------------------------------- boot */
  function mount() {
    var items = liveItems();
    /* Nothing to gather up. An empty bubble would be chrome pretending to be a
       feature — the exact thing this change exists to remove. */
    if (items.length < 2) { unmount(); return false; }
    if (root) { sync(); return true; }
    css();
    build(items);
    D.body.classList.add(BODY_ON);
    sync();
    return true;
  }

  function unmount() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = face = fan = faceName = null;
    if (D.body) D.body.classList.remove(BODY_ON);
  }

  /* The three controls arrive from different modules at different times, and
     their state changes without notifying anyone. One observer, coalesced into
     an animation frame, rather than a polling timer — this surface already has
     a documented idle-churn problem and must not add a tick to it. */
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    (W.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      pending = false;
      safe(mount);
    });
  }

  function start() {
    safe(mount);
    safe(function () {
      var mo = new MutationObserver(schedule);
      mo.observe(D.documentElement, {
        subtree: true, childList: true,
        attributes: true, attributeFilter: ['class', 'aria-pressed', 'style', 'hidden', 'disabled']
      });
    });
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else start();

  W.__mlsVoiceCluster = {
    version: VERSION,
    /* Exposed so the preview runtime can open the fan without
       re-implementing it. The fan is disclosure, not action: the three
       tools inside stay blocked in preview and keep their own refusals. */
    toggle: function () { toggle(); return !!(root && root.classList.contains('open')); },
    /* Put the three back exactly as they were. Nothing else to undo, because
       nothing else was taken. */
    revert: function () { unmount(); var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); return true; },
    describe: function () {
      return {
        version: VERSION,
        mounted: !!root,
        open: !!(root && root.classList.contains('open')),
        live: !!(root && root.classList.contains('live')),
        /* mounted:true is not the same as VISIBLE — that distinction is what
           made a b651 verification true and irrelevant. Report both, plus the
           twin geometry the decision is made from, so nobody has to sweep. */
        standDown: standDown(),
        visible: !!(root && !root.classList.contains('standdown') &&
                    root.getBoundingClientRect().width > 0),
        twins: TWINS.map(function (id) {
          var t = $(id);
          if (!t) return { id: id, present: false };
          var r = t.getBoundingClientRect();
          return { id: id, present: true, display: getComputedStyle(t).display,
                   w: Math.round(r.width), h: Math.round(r.height) };
        }),
        items: ITEMS.map(function (it) {
          var el = $(it.id);
          return { key: it.key, id: it.id, present: !!el, available: available(el), on: isOn(el) };
        })
      };
    }
  };
})();
