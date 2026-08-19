'use strict';
/* ============================================================================
   THE EVERY-BUTTON CONTRACT  -  the owner's law, made permanent

   Owner, 2026-08-19, verbatim: "everything should work as its designed if there
   is a button that doesnt work its a huge problem every single button should
   work ok."

   THE LAW, AS A MACHINE CHECK. From a fresh boot this suite walks every view
   the shell's router can reach, crawls into every surface those views open,
   enumerates every visible control on each one, presses it, and requires that
   something observable happened somewhere in the document within two seconds.
   Any of these is a pass, because any of them is the program answering:
     - the DOM changed (a panel, a row, a dialog, a fold, a label, a toast)
     - it navigated, or tried to
     - it asked: an mlsConfirm / mlsPrompt / info dialog
     - it refused HONESTLY - "Choose a patient first" is a working button
     - it went busy: aria-busy, a spinner, a named busy state

   A press that produces NOTHING observable ANYWHERE in the document is a named
   failure carrying the control's id, its label, and the surface it was found
   on. The dead list must print empty or this suite fails and prints all of it.

   TWO KINDS OF CONTROL, TWO CONTRACTS. The rule above is for ACTION controls -
   buttons, tabs, disclosures, anything clicked. A VALUE control (a field, a
   dropdown, a checkbox) is judged on whether it HELD what was put into it,
   because a field that waits for Save is supposed to change nothing when you
   touch it. MEASURED: judging both the same way reported the new-appointment
   Duration dropdown as dead when it was behaving exactly as designed.

   THIS SUITE IS NOT ABOUT ANY ONE LANE. It is the standing law: a future lane
   that ships a dead button breaks this, loudly, by name.

   ---------------------------------------------------------------------------
   WHAT MAKES THIS HARD, AND WHAT THE INSTRUMENT DOES ABOUT IT

   Every difficulty below was measured. Most were measured the expensive way by
   the Settings inventory (tests/1p-settings-redesign-contract.test.js), which
   called EIGHT working controls dead before its instrument was fixed. The
   instrument lies first.

   1. AMBIENT CHURN. The shell repaints on its own - clocks, the calm shell's
      once-a-second meta line, the activity bar. A naive "did the DOM change?"
      calls every button alive. So each surface is first watched with NOTHING
      pressed, and the set of nodes that move on their own is recorded. Only a
      node that moved during the press and NOT during that ambient window is
      evidence. Ambient tickers hit the same nodes every second, so they cancel.

   2. TRANSIENT EVIDENCE. A toast clears itself after 4s, "Copied" is gone
      sooner, and a busy state on a fast handler is gone in a frame. A single
      sample taken after the press finds the page back at its baseline and
      reports a working control dead. Everything here is watched ACROSS the
      press window by a MutationObserver, which sees a change already undone.

   3. THE INSTRUMENT'S OWN BLIND SPOT. A control is never called dead on one
      silent press. It is pressed a SECOND time behind a fresh ambient sample,
      and only a control that is silent BOTH times reaches the dead list.

   4. SCOPE. Many controls in this shell open a surface somewhere else in the
      document. Everything is measured over the WHOLE document, never scoped to
      the surface the control was found on.

   5. THE PAGE MOVES UNDER THE WALK. A press can open a modal, switch views, or
      close the surface being walked. After every press the crawler re-reads
      where it is; if it moved, the surface it landed on is QUEUED - that is a
      screen the shell can reach and it has buttons on it - and the walk returns
      to where it was. If it cannot get back, it re-boots rather than carry on
      somewhere else, because a walk that silently continues on the WRONG
      surface reports every control after it dead.

   6. THIS SHELL NEVER CALLS NATIVE alert/confirm/prompt. It asks through its
      own promise-returning mlsConfirm / mlsPrompt / _infoDialog. Hooking
      window.confirm would therefore catch nothing, and leaving mlsConfirm real
      would park an open dialog in front of every later press. They are stubbed
      to COUNT the ask and then DECLINE it: the ask is the control answering,
      and declining keeps a "delete this patient" press from emptying the list
      the rest of the walk is standing on.

   7. THE BUNDLE GATE. Shared with every other shell suite: the feature modules
      ride a gate only a login opens. Without the explicit
      window.__mlsEnsureUiBundle() call in boot() this walks a bare shell and
      every assertion passes vacuously. The boot loader also blanks the whole
      body behind #sfGateLoading, so boot() waits that out explicitly - starting
      the walk underneath it would find nothing visible and press nothing.

   ---------------------------------------------------------------------------
   WHAT IS EXCLUDED, AND WHY EXCLUSIONS ARE NAMED

   Nothing is skipped silently. Every exclusion states what it matches and why,
   all of them are printed on every run, and PART 1 asserts each one's `proof`
   string still EXISTS in both shells - an exclusion whose subject is gone is a
   stale exclusion, and a stale exclusion is how a dead button hides behind a
   green suite.

   An environment limit is excluded only when it CANNOT be removed. Most can:
   the clipboard, window.print, window.open and blob downloads are stubbed and
   counted, so all ~40 copy controls, every print control and every export are
   walked and judged like anything else. What genuinely cannot be answered is:

     HEADLESS - a native file picker (headless Chrome has none to open) and the
     microphone/speech capture (no device, and it opens a blocking consent
     ceremony). Excluded from the press; their wiring is asserted statically.

     COSTLY - pressing it would end the walk: it signs the account out, wipes
     the device's stored data, or drops the kiosk over the app and traps Back
     behind a password. NOT waived - any of these the walk MEETS is pressed at
     the END on its own fresh boot, so the law still covers it.

     MEASURED, and the report must not overstate this: on this tree the walk
     meets none of them. The header's own tool row - Ask, Find, Patient intake,
     Templates, Custom widget, Settings, Log out - is display:none, because the
     dock lane relocates those controls into the dock. They are not on screen
     for a reader either, so there is nothing for a press to judge, and the
     costly pass correctly runs over an empty list. What still holds them to
     account is PART 1, which fails the moment their wiring leaves the shell.
     The moment one of them becomes reachable again, the walk meets it and the
     fresh-boot pass presses it - the machinery is live, not decorative.

     GATED - a view the build has not released (legalreq, team). The router
     refuses it by design, so there is nothing to press and nothing is wrong.
     Reported by name so the day it ships, it joins the walk.

   A control DISABLED at rest is counted and reported, not judged: a greyed-out
   control that does nothing is behaving correctly and the user can see it is
   off. Whether it explains itself is the Settings suite's assertion, not this
   one's.

   COST. This is a slow suite by construction - real Chrome, an ambient sample
   per surface, and several hundred presses. Its measured runtime is stated
   where it is registered in run-all.js.
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

const PRESS_WINDOW_MS = 2000;
const AMBIENT_MS = 2600;
/* Caps exist so a runaway crawl cannot hang a gate that has no timeout.
   Hitting one is a FAILURE, never a silent truncation - an absence proved by
   a truncated walk is not an absence. */
const MAX_SURFACES = 40;
const MAX_CONTROLS = 900;
/* How many freshly-revealed controls one press may open up. A press that
   reveals a 300-row list should not turn into a 300-press detour. */
const REVEALED_CAP = 25;
/* How deep to follow what a press reveals. MEASURED: at this viewport the
   header's own tools - Settings, Templates, Patient intake, Log out - have
   ZERO-SIZE rects, because the dock relocates them into a Tools panel that is
   two presses down. A one-level reveal walk never classified Log out at all,
   and the costly-control pass it feeds ran on an empty list. */
const REVEAL_DEPTH = 3;

/* The shell's router and its full argument set (showView, 1pScribeFlow.html).
   Walking these is what makes this a walk of the app rather than of one page:
   the nav tabs themselves are role- and tier-gated and several ship hidden. */
const VIEWS = ['patients', 'visit', 'history', 'recs', 'orders', 'admin',
  'team', 'analysis', 'legalreq', 'studio', 'calendar'];
/* Refused by the router unless the build released them. Not a defect. */
const GATED_VIEWS = { legalreq: '__MLS_LEGAL_WORKSPACE_RELEASED', team: '__MLS_TEAM_WORKSPACE_RELEASED' };

/* ============================================================ THE INSTRUMENT */
function harness() {
  function visible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (parseFloat(s.opacity || '1') < 0.05) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function name(el) {
    var t = (el.getAttribute('aria-label') || '').trim();
    if (!t && el.id) {
      var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lab) t = (lab.innerText || lab.textContent || '').trim();
    }
    if (!t && el.closest) { var l2 = el.closest('label'); if (l2) t = (l2.innerText || '').trim(); }
    if (!t) t = (el.innerText || el.textContent || '').trim();
    if (!t) t = (el.getAttribute('placeholder') || el.getAttribute('title') || '').trim();
    return t.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [], n = el;
    for (var hops = 0; n && n.nodeType === 1 && hops < 8; hops++, n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      var i = 1, s = n.previousElementSibling;
      while (s) { if (s.tagName === n.tagName) i++; s = s.previousElementSibling; }
      parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    return parts.join(' > ');
  }
  /* The identity of a node, for attribution. Ambient tickers rewrite the SAME
     node every second; a real press touches one they never touch. */
  function nodeKey(n) {
    if (!n) return '?';
    var el = n.nodeType === 1 ? n : n.parentElement;
    if (!el) return 'text';
    var k = el.tagName.toLowerCase();
    if (el.id) k += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      k += '.' + el.className.split(/\s+/).slice(0, 3).join('.');
    }
    return k;
  }

  var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,summary,'
    + '[role=button],[role=tab],[role=menuitem],[role=switch],[onclick]';

  var W = { mut: null, keys: null, asks: 0, lastAsk: '', navs: 0, opens: 0, errs: [] };

  /* ---- every way this app can answer a press, counted ------------------- */
  /* Native dialogs, for completeness - this shell does not use them, but a
     future lane might, and an unhooked confirm() would hang the run. */
  window.alert = function (m) { W.asks++; W.lastAsk = String(m == null ? '' : m).slice(0, 120); };
  window.confirm = function (m) { W.asks++; W.lastAsk = String(m == null ? '' : m).slice(0, 120); return false; };
  window.prompt = function (m) { W.asks++; W.lastAsk = String(m == null ? '' : m).slice(0, 120); return null; };
  /* The dialogs this shell REALLY uses. Counted, then declined: the ask is the
     control answering the press, and declining is what stops a "delete this"
     press from emptying the list the rest of the walk stands on. */
  window.mlsConfirm = function (m) { W.asks++; W.lastAsk = 'confirm: ' + String(m == null ? '' : m).slice(0, 110); return Promise.resolve(false); };
  window.mlsPrompt = function (m) { W.asks++; W.lastAsk = 'prompt: ' + String(m == null ? '' : m).slice(0, 110); return Promise.resolve(null); };
  window._infoDialog = function (t, x) { W.asks++; W.lastAsk = 'info: ' + String(t || x || '').slice(0, 110); };
  window.open = function () { W.opens++; return null; };
  window.print = function () { W.asks++; W.lastAsk = '(print)'; };
  /* Removable environment limits: stubbed rather than excluded, so every copy,
     print and export control is walked and judged like any other. */
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: function (t) { W.asks++; W.lastAsk = '(clipboard) ' + String(t || '').slice(0, 60); return Promise.resolve(); },
        readText: function () { return Promise.resolve('EBPROBE'); }
      }
    });
  } catch (e) { W.errs.push('clipboard-hook:' + String(e && e.message).slice(0, 60)); }
  try { document.execCommand = function () { W.asks++; W.lastAsk = '(execCommand copy)'; return true; }; } catch (e) {}
  try {
    ['assign', 'replace', 'reload'].forEach(function (m) {
      Object.defineProperty(location, m, {
        configurable: true, writable: true,
        value: function () { W.navs++; return undefined; }
      });
    });
  } catch (e) { W.errs.push('nav-hook:' + String(e && e.message).slice(0, 60)); }
  window.addEventListener('hashchange', function () { W.navs++; });
  /* The stack, not just the message: "Maximum call stack size exceeded" names
     no culprit, and the first frames are the difference between a defect in the
     app and a defect in this harness. */
  window.addEventListener('error', function (e) {
    var st = '';
    try { st = (e && e.error && e.error.stack) ? String(e.error.stack).split('\n').slice(0, 7).join(' | ') : ''; } catch (x) {}
    W.errs.push(String((e && e.message) || '').slice(0, 120) + (st ? ' @@ ' + st.slice(0, 420) : ''));
  });
  /* A link that really navigates, a form that really posts, or a blob download
     takes the page out from under the walk and every control after it reports
     dead. All three ARE the control working, so all three are counted and then
     stopped. An in-page anchor is left alone - it moves the hash, which the
     listener above sees. */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.hasAttribute('download')) { e.preventDefault(); W.navs++; return; }
    var h = a.getAttribute('href') || '';
    if (/^javascript:/i.test(h) || h.charAt(0) === '#') return;
    e.preventDefault();
    W.navs++;
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); W.navs++; }, true);
  /* Downloads are triggered by a synthetic a.click() on a detached anchor,
     which never reaches the listener above. */
  try {
    var realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute && this.hasAttribute('download')) { W.navs++; return undefined; }
      return realClick.apply(this, arguments);
    };
  } catch (e) { W.errs.push('anchor-hook:' + String(e && e.message).slice(0, 60)); }

  window.__eb = {
    visible: visible, name: name, cssPath: cssPath,
    /* Where the walk is: the visible top-level screens, the visible view, and
       any open modal. The views are NOT children of body, so a key built only
       from body's children cannot tell one room from another. */
    surfaceKey: function () {
      var mods = [];
      Array.prototype.slice.call(document.querySelectorAll('.modal-bg,[role=dialog],dialog'))
        .forEach(function (m) { if (visible(m)) mods.push(m.id || String(m.className).slice(0, 24)); });
      var screens = [];
      Array.prototype.slice.call(document.querySelectorAll('body > div[id],body > section[id],body > main[id]'))
        .forEach(function (s) { if (visible(s)) screens.push(s.id); });
      var views = [];
      Array.prototype.slice.call(document.querySelectorAll('[id$="View"]'))
        .forEach(function (v) { if (visible(v)) views.push(v.id); });
      return screens.sort().join(',') + ' | ' + views.sort().join(',') + ' | ' + mods.sort().join(',');
    },
    /* The router, not the nav tabs: several tabs ship hidden or role-gated, so
       clicking them would silently walk nothing. */
    gotoView: function (v) {
      try { if (typeof window.showView === 'function') window.showView(v); } catch (e) { return 'threw'; }
      return 'called';
    },
    viewVisible: function (id) {
      var el = document.getElementById(id);
      return !!(el && visible(el));
    },
    /* WHAT IS OPEN, BY IDENTITY. Re-entry used to be verified by comparing the
       whole surfaceKey string, and MEASURED that way 8 of 9 rooms came back
       UNREACHABLE after 48 fruitless re-boots: the key also carries whatever
       transient DOM happened to be up when it was first recorded, so it almost
       never reproduces. A surface is identified by WHICH ROOM is open and WHICH
       DIALOG is on top of it - not by a string that includes the weather. */
    openModals: function () {
      var out = [];
      Array.prototype.slice.call(document.querySelectorAll('.modal-bg,[role=dialog],dialog'))
        .forEach(function (m) {
          if (!visible(m)) return;
          out.push(m.id || ('anon:' + String(m.className || '').slice(0, 24)));
        });
      ['_mlsInfoDialog', 'ikExitModal', 'mlsQuickFindOv'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && visible(el) && out.indexOf(id) < 0) out.push(id);
      });
      return out;
    },
    isOpen: function (id) {
      if (!id) return false;
      return window.__eb.openModals().indexOf(id) >= 0;
    },
    /* What a value control is holding now. A field is judged on whether it TOOK
       what was put in it, not on whether the page moved - see judge(). */
    probeUsed: function () { return W.probe == null ? '' : String(W.probe); },
    valueOf: function (sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      if (el.type === 'checkbox' || el.type === 'radio') return 'checked:' + String(!!el.checked);
      return String(el.value == null ? '' : el.value);
    },
    bootGateUp: function () {
      var g = document.getElementById('sfGateLoading');
      return !!(g && visible(g)) || document.documentElement.classList.contains('mls-secure-loading');
    },
    controls: function () {
      var out = [], seen = {};
      Array.prototype.slice.call(document.querySelectorAll(CTRL)).forEach(function (el) {
        if (!visible(el)) return;
        var sel = cssPath(el);
        if (!sel || seen[sel]) return;
        seen[sel] = 1;
        out.push({
          sel: sel, id: el.id || '',
          tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
          label: name(el),
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          onclick: (el.getAttribute('onclick') || '').slice(0, 160)
        });
      });
      return out;
    },
    watchStart: function () {
      W.keys = {};
      W.a0 = W.asks; W.n0 = W.navs; W.o0 = W.opens;
      W.busy0 = document.querySelectorAll('[aria-busy="true"],[data-mls-busy],.spin,.mls-bspin,.ds-spin').length;
      if (W.mut) W.mut.disconnect();
      W.mut = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i];
          W.keys[nodeKey(r.target)] = 1;
          if (r.addedNodes) {
            for (var j = 0; j < r.addedNodes.length; j++) W.keys['+' + nodeKey(r.addedNodes[j])] = 1;
          }
        }
      });
      W.mut.observe(document.documentElement, {
        subtree: true, childList: true, attributes: true, characterData: true
      });
    },
    watchStop: function () {
      if (W.mut) { W.mut.disconnect(); W.mut = null; }
      var busy1 = document.querySelectorAll('[aria-busy="true"],[data-mls-busy],.spin,.mls-bspin,.ds-spin').length;
      return {
        keys: Object.keys(W.keys || {}),
        asks: W.asks - W.a0, lastAsk: W.lastAsk,
        navs: W.navs - W.n0, opens: W.opens - W.o0,
        busyDelta: busy1 - W.busy0
      };
    },
    errs: function () { var e = W.errs.slice(); W.errs = []; return e; },
    /* What this surface does on its own, learned once and handed back so a
       press can be judged the moment it does something the surface never does
       by itself. A working control then costs ~150ms; only a silent one pays
       the full window. */
    setAmbient: function (keys) {
      W.amb = {};
      (keys || []).forEach(function (k) { W.amb[k] = 1; });
    },
    hasNovel: function () {
      if (!W.keys) return false;
      if (W.asks > W.a0 || W.navs > W.n0 || W.opens > W.o0) return true;
      var a = W.amb || {};
      for (var k in W.keys) { if (!a[k]) return true; }
      return false;
    },
    press: function (sel) {
      var el = document.querySelector(sel);
      if (!el) return 'not-found';
      if (!visible(el)) return 'not-visible';
      var tag = el.tagName.toLowerCase();
      try {
        if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) { el.click(); return 'toggled'; }
        if (tag === 'input' && el.type === 'file') return 'file';
        if (tag === 'select') {
          var opts = Array.prototype.slice.call(el.options).filter(function (o) { return o.value !== el.value; });
          /* Prefer an option that actually carries a value: a "None" row with
             value="" would otherwise read as a field that refused to hold it. */
          var next = opts.filter(function (o) { return o.value !== ''; })[0] || opts[0];
          if (!next) return 'one-option';
          el.value = next.value;
          W.probe = next.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'changed';
        }
        if (tag === 'input' || tag === 'textarea') {
          /* A PROBE THE FIELD CAN LEGALLY HOLD. MEASURED: typing 'EBPROBE'
             into every field reported THIRTEEN date, time, month and number
             inputs as refusing their value - calJump, cpFrom, calNewDate,
             mlsEpV_heightIn, sbv2AgeMin and the rest. The browser was right to
             refuse it; a date input cannot hold a word. The harness was asking
             them for something no user could type either. */
          var probe = 'EBPROBE';
          var ty = (el.type || '').toLowerCase();
          if (ty === 'number' || ty === 'range') probe = '7';
          else if (ty === 'date') probe = '2026-08-19';
          else if (ty === 'month') probe = '2026-08';
          else if (ty === 'week') probe = '2026-W34';
          else if (ty === 'time') probe = '09:30';
          else if (ty === 'datetime-local') probe = '2026-08-19T09:30';
          else if (ty === 'email') probe = 'probe@example.test';
          else if (ty === 'url') probe = 'https://example.test';
          else if (ty === 'tel') probe = '5551234567';
          else if (ty === 'color') probe = '#336699';
          W.probe = probe;
          el.focus(); el.value = probe;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          /* .blur() alone does not run an onblur handler when the element was
             never the real focus owner - the normal case in a non-compositing
             tab - so the event is dispatched explicitly. */
          el.blur(); el.dispatchEvent(new Event('blur', { bubbles: false }));
          return 'typed';
        }
        el.click();
        return 'clicked';
      } catch (e) {
        W.errs.push(String(e && e.message).slice(0, 140));
        return 'threw';
      }
    },
    /* A SIGNED-OUT SHELL IS AN EMPTY SHELL. Measured on the first run of this
       suite: the walk reached every view and pressed FIFTY controls, because
       with no roster the patient list, the visit room, history, recs and orders
       are all empty states with nothing on them to press. An empty dead list
       measured over fifty controls is not the owner's law, it is a shell that
       was never filled in. This seeds the same synthetic roster the clunky
       contract uses - no login, no network, no PHI - and BINDS one patient,
       because the per-patient rooms render nothing until one is open. */
    seed: function () {
      var out = {};
      var NAMES = ['Ada Sample', 'Bo Synthetic', 'Cy Placeholder', 'Dee Testcase',
        'Eli Sample', 'Fay Synthetic', 'Gus Placeholder', 'Hal Testcase',
        'Ivy Sample', 'Jo Synthetic', 'Kit Placeholder', 'Lu Testcase'];
      var PROCS = ['Knee arthroscopy', 'Carpal tunnel release', 'Rotator cuff repair'];
      try {
        if (typeof setTemplates === 'function') {
          setTemplates(PROCS.map(function (p, i) {
            return { id: 'syn-t' + i, name: p, body: 'PROCEDURE: ' + p, kind: 'op' };
          }));
        }
      } catch (e) { out.tplErr = String(e && e.message).slice(0, 80); }
      try {
        savePatients(NAMES.map(function (n, i) {
          return {
            id: 'syn-' + i, name: n,
            dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
            mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i),
            notes: [{ id: 'syn-n' + i, date: '2026-08-1' + (i % 9), title: 'Office visit',
              body: 'SUBJECTIVE: synthetic harness note. OBJECTIVE: synthetic. PLAN: synthetic.' }],
            visits: [{ id: 'syn-v' + i, date: '2026-08-1' + (i % 9), reason: PROCS[i % PROCS.length] }]
          };
        }));
        out.patients = getPatients().length;
      } catch (e) { out.ptErr = String(e && e.message).slice(0, 80); }
      try {
        /* NUMERIC appointment ids, and this is not cosmetic. The calendar chip
           builds its own handler by interpolation - calChipOpen('+a.id+',...)
           - with NO quotes, which is correct for the numeric ids the scheduling
           API returns. MEASURED: seeding string ids ('syn-a0') produced
           onclick="calChipOpen(syn-a0,...)" and five calendar chips threw
           "syn is not defined" when pressed. That was the harness feeding the
           app a shape it never sees in production, not a defect in the chip. */
        window._calAppts = NAMES.map(function (n, i) {
          return { id: 9000 + i, name: n, patientId: 'syn-' + i, appt_date: '2026-08-19',
            start_at: '2026-08-19T0' + (8 + (i % 8)) + ':00:00',
            reason: PROCS[i % PROCS.length], providerName: 'Sample Provider, MD' };
        });
        out.appts = window._calAppts.length;
      } catch (e) {}
      try { renderPatients(); } catch (e) {}
      try { if (typeof openPatient === 'function') openPatient('syn-0'); } catch (e) { out.selErr = String(e && e.message).slice(0, 80); }
      /* getActivePtId(), NOT activePtId(). Measured: the first version of this
         probe called a getter that does not exist, its own try/catch swallowed
         the ReferenceError, and the suite reported that binding a patient had
         failed. The app was right and the instrument was wrong - which is the
         standing order of suspicion for everything in this file. */
      try { out.active = getActivePtId(); } catch (e) { out.selErr = String(e && e.message).slice(0, 80); }
      return out;
    },
    /* Close whatever opened, so the walk can carry on. The shell has no global
       Escape handler and no backdrop-close, so this is the same sweep the app
       itself uses when it resets transient session DOM. */
    dismiss: function () {
      var n = 0;
      Array.prototype.slice.call(document.querySelectorAll('.modal-bg.show')).forEach(function (m) {
        try { m.classList.remove('show'); n++; } catch (e) {}
      });
      ['_mlsInfoDialog', 'ikExitModal', 'mlsQuickFindOv', '_pfPop'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.parentNode) { try { el.parentNode.removeChild(el); n++; } catch (e) {} }
      });
      try { if (typeof window.mlsQuickFindClose === 'function') window.mlsQuickFindClose(); } catch (e) {}
      return n;
    }
  };
}

/* ===================================================== THE NAMED EXCLUSIONS */

const HEADLESS = [
  {
    tag: 'native file picker',
    why: 'opens a native file picker; headless Chrome has none to open, so the press cannot be answered',
    test: (c) => /input:file/.test(c.tag)
      || /^(ikFaceFile|ikCardFile|docFileInput|clinicLogoInput|tplMultiFileInput|tplMultiDrop|docAttachFile|srFiles)$/.test(c.id)
      || /^attachFile-/.test(c.id)
      || /(FileInput|File)['"]\)\s*\.click\(\)/.test(c.onclick),
    proof: 'tplMultiDrop'
  },
  {
    tag: 'microphone / speech capture',
    why: 'starts speech capture: there is no device in this harness, and the press first opens a blocking recording-consent ceremony that would stand in front of every later press',
    test: (c) => /^(captureBtn|copilotMicBtn|mlsCopVoiceBtn)$/.test(c.id)
      || /toggleCapture|startCapture/.test(c.onclick),
    proof: 'webkitSpeechRecognition'
  }
];

const COSTLY = [
  {
    tag: 'sign out',
    why: 'signs the account out and returns to the auth screen, ending the walk - pressed at the end on its own fresh boot',
    test: (c) => /\blogout\s*\(/.test(c.onclick),
    proof: 'logout('
  },
  {
    tag: 'wipe this device',
    why: 'wipes this device\'s stored data and reloads, so every later measurement would be of the wipe - pressed at the end on its own fresh boot',
    test: (c) => /clearDeviceData/.test(c.onclick + ' ' + c.id),
    proof: 'clearDeviceData'
  },
  {
    tag: 'patient kiosk',
    why: 'drops the intake kiosk over the whole app and traps Back behind the account password, so the walk could never leave it - pressed at the end on its own fresh boot',
    test: (c) => /openIntake/.test(c.onclick + ' ' + c.id),
    proof: 'openIntake'
  }
];

const matchAny = (list, c) => list.filter((e) => { try { return e.test(c); } catch (x) { return false; } })[0] || null;

/* ---------------------------------------------------------------- PART 1 */
function part1() {
  for (const shell of SHELLS) {
    const src = read(shell);
    for (const e of HEADLESS.concat(COSTLY)) {
      ok(src.indexOf(e.proof) >= 0,
        `${shell}: the "${e.tag}" exclusion rests on ${JSON.stringify(e.proof)}, which is no longer in this shell - a stale exclusion hides a dead button`);
    }
    /* The router this walk depends on. If it is renamed, the crawl would walk
       one view and report a clean sweep of a shell it never entered. */
    ok(/function\s+showView\s*\(/.test(src), `${shell}: showView() is gone, and the walk enters every room through it`);
    for (const v of VIEWS) {
      ok(src.indexOf(`'${v}'`) >= 0 || src.indexOf(`"${v}"`) >= 0,
        `${shell}: the router no longer mentions the "${v}" view`);
    }
  }
}

/* ---------------------------------------------------------------- PART 2 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      if (p.endsWith('/')) p += 'index.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  /* Without this the feature bundles never load and every press lands on a
     bare shell. */
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = 'block';
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
    /* rIC and rAF never fire in a non-compositing tab. */
    try { window.__mlsDeferAsset = (fn) => setTimeout(fn, 0); } catch (e) {}
    window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
  });
  await page.evaluate(harness);
  /* The boot gate blanks every child of body but itself. Starting underneath it
     would find nothing visible and press nothing, then report a clean sweep. */
  await page.waitForFunction(() => !window.__eb.bootGateUp(), null, { timeout: 45000, polling: 200 })
    .catch(() => {});
  await page.evaluate(() => {
    document.documentElement.classList.remove('mls-secure-loading');
    const g = document.getElementById('sfGateLoading');
    if (g && g.parentNode) g.parentNode.removeChild(g);
  });
  /* DRAIN THE HARNESS'S OWN INSTALL ERRORS BEFORE ANY CONTROL IS PRESSED.
     MEASURED: window.location.assign / replace / reload are non-configurable,
     so the navigation hook's defineProperty throws at install time; that error
     sat in the buffer until the next press drained it, and THREE working
     controls were reported as throwing "Cannot redefine property: assign".
     An instrument must never file its own failures under the app's name. The
     unhooked case is safe anyway: a control that really navigates takes the
     page with it, __eb disappears, and the crawler re-boots. */
  const notes = await page.evaluate(() => window.__eb.errs());
  /* Seeded on EVERY boot, including the re-boots the crawler falls back to:
     a walk that resumes on an empty roster reports every row control dead. */
  const seeded = await page.evaluate(() => window.__eb.seed());
  await page.waitForTimeout(1500);
  seeded.harnessNotes = notes;
  return seeded;
}

async function ambient(page, ms) {
  await page.evaluate(() => window.__eb.watchStart());
  await page.waitForTimeout(ms);
  const a = await page.evaluate(() => window.__eb.watchStop());
  await page.evaluate((keys) => window.__eb.setAmbient(keys), a.keys);
  return a.keys;
}

async function pressAndWatch(page, sel) {
  await page.evaluate(() => window.__eb.watchStart());
  const did = await page.evaluate((s) => window.__eb.press(s), sel);
  await page.waitForFunction(() => window.__eb.hasNovel(), null,
    { timeout: PRESS_WINDOW_MS, polling: 100 }).catch(() => {});
  const w = await page.evaluate(() => window.__eb.watchStop());
  const errs = await page.evaluate(() => window.__eb.errs());
  return { did, w, errs };
}

/* Press one control and return the verdict on it, or null if it was not there
   to press. A control is NEVER called dead on one silent press: the surface is
   watched again with nothing pressed, and the control pressed a second time.
   Only silent BOTH times is a verdict; anything else was the instrument. */
async function judge(page, c, amb, surfaceLabel) {
  let r = await pressAndWatch(page, c.sel);
  /* the surface re-rendered under the walk: not a verdict about this control */
  if (r.did === 'not-found' || r.did === 'not-visible') return null;
  let ev = evidenceOf(r.w, amb);
  let secondTry = false;
  if (!ev.any) {
    secondTry = true;
    const amb2 = new Set(await ambient(page, 1600));
    const r2 = await pressAndWatch(page, c.sel);
    const ev2 = evidenceOf(r2.w, amb2);
    if (ev2.any) { r = r2; ev = ev2; }
    await page.evaluate((keys) => window.__eb.setAmbient(keys), Array.from(amb));
  }
  /* ACTION OR VALUE, AND THEY ARE NOT JUDGED THE SAME WAY.

     MEASURED: #calNewDur - the Duration <select> in the new-appointment dialog
     - was reported dead. It is not. Setting it fires change, nothing else
     happens, and nothing SHOULD: the field is read when Save is pressed. A
     field that waits for Save is supposed to change nothing when you touch it,
     so demanding a visible reaction from one is demanding a defect.

     This is the same line the Settings inventory already drew
     (tests/1p-settings-redesign-contract.test.js), and it is drawn here for the
     same reason. An ACTION control - a button, a tab, a disclosure, anything
     clicked - must answer. A VALUE control must simply HOLD what was put into
     it; that is its whole job, and it is asserted separately below. */
  const kind = /^(typed|changed|toggled|one-option)$/.test(r.did) ? 'value' : 'action';
  let took = null;
  if (kind === 'value' && r.did !== 'one-option') {
    const v = await page.evaluate((s) => window.__eb.valueOf(s), c.sel);
    const probe = await page.evaluate(() => window.__eb.probeUsed());
    took = (v !== null && v !== '') && (r.did !== 'typed' || v === probe);
  }
  return {
    surface: surfaceLabel, sel: c.sel, id: c.id, label: c.label, tag: c.tag,
    did: r.did, kind, took, how: ev.how, alive: ev.any, secondTry,
    said: (r.w.lastAsk || '').slice(0, 70), errs: r.errs
  };
}

/* WHAT A PRESS REVEALED, WALKED WHERE IT STANDS.

   Most of this shell's surfaces are not dialogs: the Tools, Visit, Review and
   AI Studio panels and the dock are popovers with no id to re-open by. Rather
   than invent a re-entry recipe for each, the controls a press reveals are
   pressed RIGHT HERE, while they are on screen and nothing has to be
   reproduced - and recursively, because the panels nest. */
async function walkRevealed(page, ctx, beforeSel, amb, surfLabel, surf, depth) {
  if (depth > REVEAL_DEPTH || ctx.stat.capControls) return;
  const after = await page.evaluate(() => window.__eb.controls());
  const revealed = after.filter((x) => !beforeSel.has(x.sel) && !ctx.seenControl.has(x.sel));
  if (!revealed.length) return;
  let n = 0;
  for (const rc of revealed) {
    if (n >= REVEALED_CAP) { ctx.stat.revealedCapped++; break; }
    if (ctx.inventory.length + ctx.excludedHeadless.length >= MAX_CONTROLS) { ctx.stat.capControls = true; break; }
    if (ctx.seenControl.has(rc.sel)) continue;
    ctx.seenControl.add(rc.sel);

    const h = matchAny(HEADLESS, rc);
    if (h) { ctx.excludedHeadless.push(Object.assign({ surface: surfLabel, tag2: h.tag, why: h.why }, rc)); continue; }
    const k = matchAny(COSTLY, rc);
    if (k) { ctx.costly.push(Object.assign({ surface: surfLabel, surf, opener: ctx.opener, tag2: k.tag, why: k.why }, rc)); continue; }
    if (rc.disabled) { ctx.disabledAtRest.push(Object.assign({ surface: surfLabel }, rc)); continue; }

    const nowSel = new Set(after.map((x) => x.sel));
    const rr = await judge(page, rc, amb, surfLabel);
    if (!rr) continue;
    ctx.inventory.push(rr);
    ctx.pressed++;
    n++;
    await walkRevealed(page, ctx, nowSel, amb,
      surfLabel + ' > ' + (rc.id || rc.label || rc.sel).slice(0, 22), surf, depth + 1);
  }
}

function evidenceOf(w, ambientSet) {
  const novel = w.keys.filter((k) => !ambientSet.has(k));
  const asked = w.asks > 0;
  const moved = w.navs > 0 || w.opens > 0;
  const busy = w.busyDelta !== 0;
  return {
    novel, asked, moved, busy,
    any: novel.length > 0 || asked || moved || busy,
    how: novel.length > 0 ? 'dom' : asked ? 'asked' : moved ? 'navigated' : busy ? 'busy' : 'nothing'
  };
}

/* Is the walk standing on this surface? The ROOM must be the right room, and
   if the surface is a dialog, that dialog must be the one that is open.

   MEASURED, and this is why it is not a string compare: re-entry used to
   require the whole surfaceKey to reproduce byte for byte, and 8 of the 9 rooms
   came back UNREACHABLE after 48 fruitless re-boots. The key also carries
   whatever transient DOM happened to be up when it was first recorded - a
   toast, a dock state, a half-faded dialog - so it almost never reproduces. A
   surface is WHICH ROOM is open and WHICH DIALOG sits on top of it. */
async function atSurface(page, surf) {
  if (surf.modalId) return page.evaluate((id) => window.__eb.isOpen(id), surf.modalId);
  const inRoom = await page.evaluate((id) => window.__eb.viewVisible(id), surf.viewId);
  if (!inRoom) return false;
  /* Replaying the way to a costly control deliberately leaves its opener's
     panel standing, so that walk only asks to be in the right room. */
  if (surf.lenient) return true;
  /* Otherwise a dialog left standing over the room hides the room's own
     controls, and the walk would report them missing rather than judge them. */
  const mods = await page.evaluate(() => window.__eb.openModals());
  return mods.length === 0;
}

/* Walk back to a surface: dismiss what is open, re-enter the room through the
   router, then replay the presses that first reached it. If that does not land,
   re-boot and replay - a walk that silently continues somewhere else reports
   every control after it dead. */
async function enter(page, port, surf, stat) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) { await boot(page, port); stat.reboots++; }
    else { await page.evaluate(() => (window.__eb ? window.__eb.dismiss() : 0)); await page.waitForTimeout(400); }
    if (surf.view) {
      await page.evaluate((v) => window.__eb.gotoView(v), surf.view);
      await page.waitForTimeout(900);
    }
    let walked = true;
    for (const sel of surf.path) {
      const r = await page.evaluate((s) => window.__eb.press(s), sel);
      if (r === 'not-found' || r === 'not-visible' || r === 'threw') { walked = false; break; }
      await page.waitForTimeout(800);
    }
    if (!walked) continue;
    if (await atSurface(page, surf)) return true;
  }
  /* Why it could not get back, in the report - "UNREACHABLE" with no reason is
     the same dead end this instrument just spent 48 re-boots in. */
  if (stat.misses.length < 8) {
    stat.misses.push({
      surface: surf.label,
      wanted: surf.modalId ? ('dialog ' + surf.modalId) : ('room ' + surf.viewId),
      got: await page.evaluate(() => window.__eb.surfaceKey())
    });
  }
  return false;
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  const inventory = [];
  const excludedHeadless = [];
  const costly = [];
  const disabledAtRest = [];
  const surfaces = [];
  const gatedViews = [];
  const stat = { reboots: 0, restores: 0, capSurfaces: false, capControls: false, misses: [], revealedCapped: 0 };

  try {
    const seeded = await boot(page, port);
    measured.seeded = seeded;
    ok(seeded && seeded.patients >= 10,
      `the synthetic roster did not land (${JSON.stringify(seeded)}) - every per-patient room would be an empty state and the walk would grade a shell nobody filled in`);
    ok(!!seeded.active, 'no patient is bound after seeding, so the visit, history, recs and orders rooms render nothing to press');

    /* ---- the queue starts as every view the router will accept ---------- */
    const queue = [];
    const seenSurface = new Set();
    for (const v of VIEWS) {
      const viewId = v === 'legalreq' ? 'legalReqView' : v + 'View';
      await page.evaluate(() => window.__eb.dismiss());
      await page.evaluate((x) => window.__eb.gotoView(x), v);
      await page.waitForTimeout(900);
      if (!(await page.evaluate((id) => window.__eb.viewVisible(id), viewId))) {
        gatedViews.push({ view: v, gate: GATED_VIEWS[v] || '(router refused)' });
        continue;
      }
      if (seenSurface.has('room:' + viewId)) continue;
      seenSurface.add('room:' + viewId);
      queue.push({ view: v, viewId, path: [], label: v });
    }
    measured.viewsOffered = VIEWS.length;
    measured.viewsEntered = queue.length;
    measured.viewsGated = gatedViews.map((g) => g.view + ' (' + g.gate + ')');

    /* Every gated view must be one the build really gates, not one that simply
       stopped working. */
    for (const g of gatedViews) {
      ok(!!GATED_VIEWS[g.view],
        `the router refused the "${g.view}" view and no release flag explains it - a whole room is unreachable`);
    }

    /* ---- the crawl ------------------------------------------------------ */
    const seenControl = new Set();
    /* One bag of state the recursive reveal walk shares with this loop, so a
       control judged three panels deep still lands in the same inventory and
       counts against the same caps. */
    const ctx = { seenControl, inventory, excludedHeadless, costly, disabledAtRest, stat, pressed: 0, opener: null };
    while (queue.length) {
      if (surfaces.length >= MAX_SURFACES) { stat.capSurfaces = true; break; }
      const surf = queue.shift();
      const entered = await enter(page, port, surf, stat);
      if (!entered) { surfaces.push({ label: surf.label, controls: 0, unreachable: true }); continue; }

      const amb = new Set(await ambient(page, AMBIENT_MS));
      const ctrls = await page.evaluate(() => window.__eb.controls());
      /* What this surface already showed, so a control that a press REVEALS can
         be told apart from one that was there all along. */
      const baseSel = new Set(ctrls.map((x) => x.sel));
      let pressedHere = 0;

      for (const c of ctrls) {
        if (inventory.length + excludedHeadless.length >= MAX_CONTROLS) { stat.capControls = true; break; }
        if (seenControl.has(c.sel)) continue;
        seenControl.add(c.sel);

        const h = matchAny(HEADLESS, c);
        if (h) { excludedHeadless.push(Object.assign({ surface: surf.label, tag2: h.tag, why: h.why }, c)); continue; }
        const k = matchAny(COSTLY, c);
        if (k) { costly.push(Object.assign({ surface: surf.label, surf, tag2: k.tag, why: k.why }, c)); continue; }
        if (c.disabled) { disabledAtRest.push(Object.assign({ surface: surf.label }, c)); continue; }

        const rec = await judge(page, c, amb, surf.label);
        if (rec) { inventory.push(rec); pressedHere++; }

        ctx.opener = c.sel;
        ctx.pressed = 0;
        await walkRevealed(page, ctx, baseSel, amb,
          surf.label + ' > ' + (c.id || c.label || c.sel).slice(0, 28), surf, 1);
        pressedHere += ctx.pressed;

        if (!(await atSurface(page, surf))) {
          stat.restores++;
          if (!(await enter(page, port, surf, stat))) break;
          await page.evaluate((keys) => window.__eb.setAmbient(keys), Array.from(amb));
        }
      }
      surfaces.push({ label: surf.label, controls: pressedHere });
      if (stat.capControls) break;
    }

    measured.surfacesWalked = surfaces.length;
    /* The count is "controls first judged while walking from this room", not
       "controls that belong to this room": a control is judged once, wherever
       it is met first, and the reveal walk follows a press into whatever it
       opens. A room reading 0 has had its controls judged already, from
       somewhere else - it is not an empty room. The full chain of openers is
       in each control's own surface label. */
    measured.surfaces = surfaces.map((s) => s.label + ':' + (s.unreachable ? 'UNREACHABLE' : s.controls));
    measured.pressed = inventory.length;
    measured.excludedHeadless = excludedHeadless.length;
    measured.disabledAtRest = disabledAtRest.length;
    measured.costlyFound = costly.length;
    measured.reboots = stat.reboots;
    measured.restores = stat.restores;
    measured.reEntryMisses = stat.misses;
    measured.revealedCapped = stat.revealedCapped;

    /* ---- the caps must not have bitten ---------------------------------- */
    eq(stat.capSurfaces, false, `the crawl hit its ${MAX_SURFACES}-surface cap: the walk is truncated, so an empty dead list means nothing`);
    eq(stat.capControls, false, `the crawl hit its ${MAX_CONTROLS}-control cap: the walk is truncated, so an empty dead list means nothing`);

    /* ---- the walk really ran -------------------------------------------- */
    ok(surfaces.length >= 9, `the crawl reached only ${surfaces.length} surfaces; it is not walking the shell`);
    ok(inventory.length >= 180, `only ${inventory.length} controls were pressed; the walk is not exercising the shell`);

    /* A surface that was opened once and could not be opened again is a limit
       of THIS instrument, not a defect in the app - the control that opened it
       answered when pressed, which is the law. It is named rather than dropped,
       and the RATIO is what is asserted: one one-shot panel is a coverage gap
       worth printing, but a walk that can only re-enter half of what it finds
       is not measuring the shell and its empty dead list would be a lie. */
    const unreachable = surfaces.filter((s) => s.unreachable);
    measured.surfacesNotWalked = unreachable.map((s) => s.label);
    const reachRatio = surfaces.length ? (surfaces.length - unreachable.length) / surfaces.length : 0;
    ok(reachRatio >= 0.85,
      `only ${Math.round(reachRatio * 100)}% of discovered surfaces could be walked (${unreachable.length} of ${surfaces.length} unreachable): ${JSON.stringify(measured.surfacesNotWalked)} - too much of the shell went unjudged for an empty dead list to mean anything. Why each one failed: ${JSON.stringify(stat.misses)}`);

    /* ---- nothing a doctor can press throws ------------------------------ */
    const threw = inventory.filter((c) => c.did === 'threw' || (c.errs && c.errs.length));
    eq(threw.length, 0, `pressing these controls threw: ${JSON.stringify(threw.slice(0, 10).map((c) => (c.id || c.label) + ' [' + c.surface + '] :: ' + (c.errs || []).join('|')))}`);

    /* ---- THE LAW -------------------------------------------------------- */
    const actions = inventory.filter((c) => c.kind === 'action');
    const values = inventory.filter((c) => c.kind === 'value');
    const dead = actions.filter((c) => !c.alive);
    measured.actionControls = actions.length;
    measured.valueControls = values.length;
    measured.dead = dead.length;
    measured.aliveBy = actions.reduce((a, c) => { a[c.how] = (a[c.how] || 0) + 1; return a; }, {});
    measured.rescuedBySecondPress = inventory.filter((c) => c.secondTry && c.alive).length;
    ok(actions.length >= 150, `only ${actions.length} action controls were pressed; the walk is not exercising the shell`);
    eq(dead.length, 0,
      'THESE CONTROLS ARE ON THE SCREEN AND PRESSING THEM DID NOTHING OBSERVABLE ANYWHERE IN THE DOCUMENT:\n'
      + dead.map((c) => `    ${c.id || '(no id)'}  "${c.label}"  <${c.tag}>  on ${c.surface}  [${c.sel}]`).join('\n'));

    /* A value control is held to its own promise instead: it must keep what was
       put into it. A dropdown with nothing else to choose is excluded and
       named - that is a property of this harness's data, not of the control. */
    const refused = values.filter((c) => c.took === false);
    measured.valuesRefused = refused.length;
    measured.oneOptionSelects = values.filter((c) => c.did === 'one-option').map((c) => c.id || c.label).slice(0, 12);
    eq(refused.length, 0,
      'THESE FIELDS WOULD NOT HOLD WHAT WAS PUT INTO THEM:\n'
      + refused.map((c) => `    ${c.id || '(no id)'}  "${c.label}"  <${c.tag}>  on ${c.surface}`).join('\n'));

    /* ---- the costly controls, each on its own fresh boot ----------------- */
    const costlyResults = [];
    for (const c of costly) {
      const p2 = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      try {
        await boot(p2, port);
        const st2 = { reboots: 0 };
        /* A costly control revealed by another press needs that press replayed
           before it is there to press at all. */
        const pathTo = c.opener ? [c.opener] : (c.surf.path || []);
        if (!(await enter(p2, port, { view: c.surf.view, viewId: c.surf.viewId, path: pathTo, lenient: true }, st2))) {
          costlyResults.push({ id: c.id, label: c.label, tag2: c.tag2, alive: false, how: 'unreachable' });
          continue;
        }
        const amb2 = new Set(await ambient(p2, 1600));
        const r = await pressAndWatch(p2, c.sel);
        const ev = evidenceOf(r.w, amb2);
        costlyResults.push({ id: c.id, label: c.label, tag2: c.tag2, alive: ev.any, how: ev.how, did: r.did });
      } finally { await p2.close(); }
    }
    measured.costlyPressed = costlyResults.length;
    const costlyDead = costlyResults.filter((c) => !c.alive);
    eq(costlyDead.length, 0,
      `these controls are kept out of the walk because they END it, so they were pressed on their own fresh boot - and did nothing: ${JSON.stringify(costlyDead)}`);

    /* ---- the exclusions are named, not silent --------------------------- */
    measured.exclusions = {
      headless: excludedHeadless.map((c) => (c.id || c.label || c.sel) + ' [' + c.tag2 + ']'),
      /* Never print an empty list where a reader would read "all clear": say
         plainly that the walk met none of them. */
      costly: costlyResults.length
        ? costlyResults.map((c) => (c.id || c.label) + ' [' + c.tag2 + '] -> ' + c.how)
        : ['(none reachable on any walked surface - the header tool row is display:none on this tree; PART 1 holds their wiring)'],
      gatedViews: measured.viewsGated,
      disabledAtRest: disabledAtRest.map((c) => (c.id || c.label || c.sel))
    };
    for (const c of excludedHeadless) ok(!!c.why, `a control was excluded with no reason given: ${c.id || c.sel}`);

    eq(pageErrors.length, 0, `the shell raised ${pageErrors.length} page errors during the walk: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

part1();
runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured, null, 1));
  console.log(`1p-every-button-contract: ${checks} checks passed`);
}).catch((e) => {
  /* The inventory is the evidence, so it prints on the way DOWN too - a
     failure that hides what was measured cannot be diagnosed. */
  console.error('MEASURED ' + JSON.stringify(measured, null, 1));
  console.error('1p-every-button-contract FAILED: ' + (e && e.message));
  process.exit(1);
});
