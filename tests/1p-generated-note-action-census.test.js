'use strict';
/* ============================================================================
   THE GENERATED / RESTORED NOTE ACTION CENSUS  (noteact-1.0.0)

   Owner P0, 2026-08-27, from Codex's read-only audit of the Visit review
   screenshots: the apparently dead buttons on the note review surface are
   mainly SILENT NO-NOTE GATING. Seventeen controls in the visit review action
   row ship natively `disabled` and unlock only when showNote() runs. The
   standing every-button walk (tests/1p-every-button-contract.test.js) records
   a disabled-at-rest control and moves on WITHOUT pressing it, and it never
   seeds a successful generated or restored note, so every one of those
   seventeen controls has never been pressed by any gate in this repo.

   THIS SUITE CLOSES THAT HOLE, on both sides of the gate.

   PART A - THE GATE EXPLAINS ITSELF (no note).
     A control that is off must say WHY it is off and offer the next step.
     Every gated control carries aria-disabled="true" and a reason in its
     title, and one visible sentence plus one real next-action control stands
     in the action row. Measured at rest, before anything is generated.

   PART B - THE CENSUS (note present).
     A successful generated note is seeded through the shipped showNote()
     path, and separately a RESTORED note through loadRecordIntoEditor(). The
     seeding is asserted first - a census run against a shell where the note
     never landed would press seventeen still-disabled controls and call the
     silence a pass. Then EVERY expected control on the surface is pressed,
     including the ones that were disabled at rest, and each must produce one
     of five observable outcomes:

       visible result   - novel DOM anywhere in the document
       visible refusal  - a toast, an inline error line, or an ask
       navigation       - a view change, location call, or window.open
       download         - an anchor[download] click
       Athena bridge    - openUnifiedConfirmation() on the write-flow

     Nothing is skipped silently: the expected list is NAMED, a member that is
     missing from the shell is a failure, and the only exclusion (#imeBtn) is
     held by the build itself and asserted to still be held.

   THE INSTRUMENT LIES FIRST. Same three defences as the every-button walk:
   the surface is watched with nothing pressed so the shell's own clocks
   cannot pass for an answer; evidence is collected across the press window by
   a MutationObserver so a toast that clears itself still counts; and no
   control is called dead on one silent press.
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

const PRESS_WINDOW_MS = 2200;
const AMBIENT_MS = 2400;

/* The seventeen controls enableOutputs() owns - the ones that are natively
   disabled until a note exists. Named here so that a lane which drops one of
   them from the shell breaks this suite by name rather than shrinking the
   census silently. */
const GATED_IDS = ['signBtn', 'copyBtn', 'copyEmrBtn', 'printBtn', 'dlBtn', 'optBtn',
  'saveNoteBtn', 'avsBtn', 'refBtn', 'imeBtn', 'billBtn', 'mipsBtn', 'handoutBtn',
  'fhirBtn', 'redflagBtn', 'ddxBtn', 'teachBtn'];

/* HELD BY THE BUILD, not by this suite: #imeBtn ships hidden + aria-hidden +
   display:none and enableOutputs() re-holds it on every call. It is not on
   screen for a reader either, so there is nothing for a press to judge. PART A
   asserts it is still held, so the day it ships it joins the census. */
const HELD = {
  imeBtn: 'the IME report control is held by the build (hidden + aria-hidden + display:none, re-held by enableOutputs on every call)',
  /* MEASURED: #emrBtn is the retired standalone launcher. The dock lane ships
     "#emrBtn{display:none!important}" and routes the doctor to it through
     "Preview EMR placement", which IS in the census and clicks it. Judging the
     hidden launcher itself would grade a control no reader can see. */
  emrBtn: 'the standalone EMR sections launcher is hidden by the dock lane; the census reaches the same modal through Preview EMR placement'
};

/* Every control a doctor can see on the visit review action surface once a
   note exists. Ids where the shell gives one; a stable selector otherwise. */
const EXPECTED = [
  { id: 'signBtn', what: 'Review & Sign' },
  { id: 'saveNoteBtn', what: 'Save to history' },
  { id: 'copyEmrBtn', what: 'Copy note text' },
  { id: 'pushAllEmrBtn', what: 'Review Athena actions' },
  { id: 'moreToolsBtn', what: 'More tools' },
  { id: 'copyBtn', what: 'Copy' },
  { id: 'printBtn', what: 'Print' },
  { id: 'gradeExpBtn', what: 'Grade experience' },
  { id: 'optBtn', what: 'E/M documentation & coding review' },
  { id: 'mipsBtn', what: 'MIPS check' },
  { id: 'redflagBtn', what: 'Red-flag scan' },
  { id: 'ddxBtn', what: 'Differentials' },
  { id: 'avsBtn', what: 'Patient summary' },
  { id: 'handoutBtn', what: 'Patient handout' },
  { id: 'refBtn', what: 'Referral letter' },
  { id: 'billBtn', what: 'Superbill' },
  { id: 'costBtn', what: 'Cost estimate' },
  { id: 'teachBtn', what: 'Teach MLS' },
  { id: 'fhirBtn', what: 'Export FHIR' },
  { id: 'templatesBtn', what: 'Templates' },
  { id: 'dlBtn', what: 'Download .txt' },
  { sel: '#secCopyRow button:nth-of-type(1)', what: 'Copy section: Subjective' },
  { sel: '#secCopyRow button:nth-of-type(2)', what: 'Copy section: Objective' },
  { sel: '#secCopyRow button:nth-of-type(3)', what: 'Copy section: Assessment' },
  { sel: '#secCopyRow button:nth-of-type(4)', what: 'Copy section: Plan' },
  /* HELD BY THE BUILD, and the hold is asserted below so it cannot go stale:
     the dock lane ships
       body.ez3adv #noteCard button[onclick*="regenerateNote"]{display:none}
     because the Easy lane owns Generate/Regenerate whenever the advanced
     workspace is open. It is not on screen for a reader either, so a press
     would grade a control nobody can reach. */
  { sel: '#secCopyRow button:nth-of-type(5)', what: 'Regenerate', held: 'the dock lane hides Regenerate inside #noteCard while Advanced tools is open - the Easy lane owns regeneration there' },
  { sel: '#revToolsCard button:nth-of-type(1)', what: 'Denial-risk check' },
  { sel: '#revToolsCard button:nth-of-type(2)', what: 'Draft prior-auth letter' },
  { sel: '#dsCard button:nth-of-type(1)', what: 'Analyze this visit' },
  { id: 'b49EmrPrevBtn', what: 'Preview EMR placement' },
  { id: 'emrBtn', what: 'EMR sections' }
];

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
  var W = { mut: null, keys: null, asks: 0, lastAsk: '', navs: 0, opens: 0, dls: 0, bridge: 0, errs: [] };

  window.alert = function (m) { W.asks++; W.lastAsk = String(m == null ? '' : m).slice(0, 120); };
  window.confirm = function (m) { W.asks++; W.lastAsk = String(m == null ? '' : m).slice(0, 120); return false; };
  window.prompt = function (m) { W.asks++; W.lastAsk = String(m == null ? '' : m).slice(0, 120); return null; };
  window.mlsConfirm = function (m) { W.asks++; W.lastAsk = 'confirm: ' + String(m == null ? '' : m).slice(0, 110); return Promise.resolve(false); };
  window.mlsPrompt = function (m) { W.asks++; W.lastAsk = 'prompt: ' + String(m == null ? '' : m).slice(0, 110); return Promise.resolve(null); };
  window._infoDialog = function (t, x) { W.asks++; W.lastAsk = 'info: ' + String(t || x || '').slice(0, 110); };
  window.open = function () { W.opens++; return null; };
  window.print = function () { W.asks++; W.lastAsk = '(print)'; };
  try {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: function (t) { W.asks++; W.lastAsk = '(clipboard) ' + String(t || '').slice(0, 60); return Promise.resolve(); },
        readText: function () { return Promise.resolve('CENSUS'); }
      }
    });
  } catch (e) { W.errs.push('clipboard-hook:' + String(e && e.message).slice(0, 60)); }
  try { document.execCommand = function () { W.asks++; W.lastAsk = '(execCommand copy)'; return true; }; } catch (e) {}
  try {
    ['assign', 'replace', 'reload'].forEach(function (m) {
      Object.defineProperty(location, m, { configurable: true, writable: true, value: function () { W.navs++; } });
    });
  } catch (e) { W.errs.push('nav-hook:' + String(e && e.message).slice(0, 60)); }
  window.addEventListener('hashchange', function () { W.navs++; });
  window.addEventListener('error', function (e) {
    var st = '';
    try { st = (e && e.error && e.error.stack) ? String(e.error.stack).split('\n').slice(0, 6).join(' | ') : ''; } catch (x) {}
    W.errs.push(String((e && e.message) || '').slice(0, 120) + (st ? ' @@ ' + st.slice(0, 300) : ''));
  });
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.hasAttribute('download')) { e.preventDefault(); W.dls++; return; }
    var h = a.getAttribute('href') || '';
    if (/^javascript:/i.test(h) || h.charAt(0) === '#') return;
    e.preventDefault(); W.navs++;
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); W.navs++; }, true);
  try {
    var realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute && this.hasAttribute('download')) { W.dls++; return undefined; }
      return realClick.apply(this, arguments);
    };
  } catch (e) { W.errs.push('anchor-hook:' + String(e && e.message).slice(0, 60)); }

  /* THE ATHENA BRIDGE, counted as its own outcome. "Review Athena actions"
     opens the unified confirmation sheet through the write-flow; that call is
     the button answering even in the run where the sheet paints late. */
  function hookBridge() {
    try {
      var wf = window.__mlsWriteFlow;
      if (!wf || wf.__censusHooked || typeof wf.openUnifiedConfirmation !== 'function') return;
      var real = wf.openUnifiedConfirmation;
      wf.openUnifiedConfirmation = function () { W.bridge++; return real.apply(this, arguments); };
      wf.__censusHooked = true;
    } catch (e) {}
  }
  hookBridge();

  window.__nc = {
    visible: visible,
    hookBridge: hookBridge,
    label: function (el) {
      if (!el) return '';
      var t = (el.getAttribute('aria-label') || '').trim();
      if (!t) t = (el.innerText || el.textContent || '').trim();
      if (!t) t = (el.getAttribute('title') || '').trim();
      return t.replace(/\s+/g, ' ').slice(0, 60);
    },
    /* What the surface does on its own, so a press can be judged the moment it
       does something the surface never does by itself. */
    watchStart: function () {
      W.keys = {};
      W.a0 = W.asks; W.n0 = W.navs; W.o0 = W.opens; W.d0 = W.dls; W.b0 = W.bridge;
      W.busy0 = document.querySelectorAll('[aria-busy="true"],[data-mls-busy],.spin,.mls-bspin,.ds-spin').length;
      if (W.mut) W.mut.disconnect();
      W.mut = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i];
          W.keys[nodeKey(r.target)] = 1;
          if (r.addedNodes) for (var j = 0; j < r.addedNodes.length; j++) W.keys['+' + nodeKey(r.addedNodes[j])] = 1;
        }
      });
      W.mut.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    },
    watchStop: function () {
      if (W.mut) { W.mut.disconnect(); W.mut = null; }
      var busy1 = document.querySelectorAll('[aria-busy="true"],[data-mls-busy],.spin,.mls-bspin,.ds-spin').length;
      return {
        keys: Object.keys(W.keys || {}),
        asks: W.asks - W.a0, lastAsk: W.lastAsk, navs: W.navs - W.n0,
        opens: W.opens - W.o0, dls: W.dls - W.d0, bridge: W.bridge - W.b0,
        busyDelta: busy1 - W.busy0
      };
    },
    setAmbient: function (keys) { W.amb = {}; (keys || []).forEach(function (k) { W.amb[k] = 1; }); },
    hasNovel: function () {
      if (!W.keys) return false;
      if (W.asks > W.a0 || W.navs > W.n0 || W.opens > W.o0 || W.dls > W.d0 || W.bridge > W.b0) return true;
      var a = W.amb || {};
      for (var k in W.keys) { if (!a[k]) return true; }
      return false;
    },
    errs: function () { var e = W.errs.slice(); W.errs = []; return e; },
    find: function (d) {
      var el = d.id ? document.getElementById(d.id) : document.querySelector(d.sel);
      if (!el) return null;
      return el;
    },
    /* At-rest gate report for ONE control: is it off, does it say why, and is
       the reason machine-readable. */
    gateOf: function (d) {
      var el = d.id ? document.getElementById(d.id) : document.querySelector(d.sel);
      if (!el) return { present: false };
      return {
        present: true, visible: visible(el),
        disabled: !!el.disabled,
        ariaDisabled: el.getAttribute('aria-disabled') || '',
        /* THE TOOLTIP CARRIER ON THIS SHELL IS data-tip, and that is not a
           relaxation. initTooltips() converts every title to data-tip on
           purpose so the browser's native bubble never doubles the app's own,
           and its MutationObserver keeps doing it - MEASURED here, which found
           the reason present in data-mls-gate-reason and the title erased
           within a frame. A hover reason must be judged where the app puts it. */
        title: (el.getAttribute('title') || '').trim(),
        tip: (el.getAttribute('data-tip') || '').trim(),
        reason: (el.getAttribute('data-mls-gate-reason') || '').trim(),
        hidden: !!el.hidden, ariaHidden: el.getAttribute('aria-hidden') || '',
        display: (el.style && el.style.display) || ''
      };
    },
    press: function (d) {
      var el = d.id ? document.getElementById(d.id) : document.querySelector(d.sel);
      if (!el) return 'not-found';
      if (!visible(el)) return 'not-visible';
      try { el.click(); return 'clicked'; } catch (e) { W.errs.push(String(e && e.message).slice(0, 140)); return 'threw'; }
    },
    /* Close whatever the press opened so the census can carry on. */
    dismiss: function () {
      var n = 0;
      Array.prototype.slice.call(document.querySelectorAll('.modal-bg.show')).forEach(function (m) {
        try { m.classList.remove('show'); n++; } catch (e) {}
      });
      ['_mlsInfoDialog', 'ikExitModal', 'mlsQuickFindOv', '_pfPop', 'emrPanel'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.parentNode) { try { el.parentNode.removeChild(el); n++; } catch (e) {} }
      });
      try { if (typeof window.mlsQuickFindClose === 'function') window.mlsQuickFindClose(); } catch (e) {}
      return n;
    },
    /* The synthetic roster, one bound patient. No login, no network, no PHI. */
    seed: function () {
      var out = {};
      var NAMES = ['Ada Sample', 'Bo Synthetic', 'Cy Placeholder', 'Dee Testcase',
        'Eli Sample', 'Fay Synthetic', 'Gus Placeholder', 'Hal Testcase',
        'Ivy Sample', 'Jo Synthetic'];
      try {
        savePatients(NAMES.map(function (n, i) {
          return {
            id: 'syn-' + i, name: n, dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
            mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: []
          };
        }));
        out.patients = getPatients().length;
      } catch (e) { out.ptErr = String(e && e.message).slice(0, 90); }
      try { renderPatients(); } catch (e) {}
      try { if (typeof openPatient === 'function') openPatient('syn-0'); } catch (e) { out.selErr = String(e && e.message).slice(0, 90); }
      try { out.active = getActivePtId(); } catch (e) { out.selErr = String(e && e.message).slice(0, 90); }
      return out;
    },
    /* THE VISIT REVIEW ACTION SURFACE IS BEHIND "ADVANCED TOOLS". MEASURED:
       with the calm shell live, #noteCard and every control in it computes to
       display:none until <body> carries ez3adv - the class the shipped
       withAdvancedWorkspace() sets. A census that skipped this step would
       report all thirty-one controls "not-visible" and prove nothing. The real
       control is clicked when it is reachable; the class is the documented
       fallback for the harness's empty synthetic day, where the Easy home
       screen has no per-patient room to put that button in. */
    openAdvanced: function () {
      var out = { route: '' };
      try {
        var adv = document.getElementById('ez3Adv');
        if (adv && visible(adv)) { adv.click(); out.route = 'ez3Adv-click'; }
      } catch (e) {}
      try {
        if (!document.body.classList.contains('ez3adv')) {
          document.body.classList.add('ez3adv');
          out.route = out.route || 'ez3adv-class';
        }
      } catch (e) { out.err = String(e && e.message).slice(0, 80); }
      out.advOpen = !!(document.body && document.body.classList.contains('ez3adv'));
      var card = document.getElementById('noteCard');
      out.noteCardVisible = !!(card && visible(card));
      return out;
    },
    /* A SUCCESSFUL GENERATED NOTE, seeded through the shipped path. This is
       the state the every-button walk never builds, and the reason seventeen
       controls have never been pressed by any gate in this repo. */
    seedGenerated: function () {
      var out = {};
      var NOTE = [
        'SUBJECTIVE:',
        'Synthetic harness subject reports two weeks of right knee discomfort after a fall. No fever, no numbness.',
        '',
        'REVIEW OF SYSTEMS:',
        'Negative except as stated in the subjective section.',
        '',
        'OBJECTIVE:',
        'Physical exam: right knee with mild effusion, range of motion 5 to 120 degrees, no instability on stress testing.',
        '',
        'ASSESSMENT:',
        'Right knee pain, likely meniscal irritation. Synthetic harness content only.',
        '',
        'PLAN:',
        'Ice, relative rest, physical therapy twice weekly for four weeks. Return to clinic in four weeks.'
      ].join('\n');
      try {
        var tx = document.getElementById('transcript');
        if (tx) {
          tx.value = 'Synthetic harness transcript. Right knee pain for two weeks after a fall. Exam shows mild effusion and range of motion five to one hundred twenty degrees. Plan is physical therapy twice weekly for four weeks and return in four weeks.';
          tx.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (e) { out.txErr = String(e && e.message).slice(0, 80); }
      try {
        currentSoap = NOTE;
        currentNoteProvenance = 'generated_soap';
        lastAIDraft = NOTE;
        currentFormat = 'soap';
        currentCoding = { em: '99213', cpt: [], icd: ['M25.561'] };
        lastEMR = { cc: 'Right knee pain', dx: 'Right knee pain', meds: '', orders: 'Physical therapy', fu: '4 weeks' };
        currentOrders = [];
      } catch (e) { out.stateErr = String(e && e.message).slice(0, 80); }
      try { if (typeof syncFormatToggle === 'function') syncFormatToggle(); } catch (e) {}
      try { showNote(currentSoap); } catch (e) { out.showErr = String(e && e.message).slice(0, 90); }
      try { if (typeof renderCoding === 'function') renderCoding(currentCoding); } catch (e) {}
      try { if (typeof populateEMR === 'function') populateEMR(lastEMR, currentCoding); } catch (e) {}
      var nb = document.getElementById('noteBox');
      out.noteVisible = !!(nb && visible(nb));
      out.noteLength = nb ? String(nb.value || '').length : 0;
      out.provenance = (typeof currentNoteProvenance === 'string') ? currentNoteProvenance : '';
      return out;
    },
    /* A RESTORED note, through the shipped history path. */
    seedRestored: function () {
      var out = {};
      var NOTE = 'SUBJECTIVE:\nRestored synthetic harness note. Interval history unchanged.\n\n'
        + 'REVIEW OF SYSTEMS:\nNegative except as stated.\n\n'
        + 'OBJECTIVE:\nPhysical exam: no new findings on this restored synthetic record.\n\n'
        + 'ASSESSMENT:\nStable. Synthetic harness content only.\n\n'
        + 'PLAN:\nContinue current plan. Return to clinic in six weeks.';
      var record = {
        id: 'syn-rec-1', patient: 'Ada Sample', date: '2026-08-19',
        transcript: 'Restored synthetic harness transcript with enough documented detail to support the sections above.',
        soap: NOTE, noteProvenance: 'generated_soap', insurance: '',
        coding: { em: '99213', cpt: [], icd: ['M25.561'] },
        emr: { cc: 'Follow-up', dx: 'Stable', meds: '', orders: '', fu: '6 weeks' },
        orders: [], signed: false, isDraft: false
      };
      try { loadRecordIntoEditor(record); } catch (e) { out.loadErr = String(e && e.message).slice(0, 120); }
      var nb = document.getElementById('noteBox');
      out.noteVisible = !!(nb && visible(nb));
      out.noteLength = nb ? String(nb.value || '').length : 0;
      out.provenance = (typeof currentNoteProvenance === 'string') ? currentNoteProvenance : '';
      return out;
    },
    /* Did the gate really open? A census over still-disabled controls would
       press nothing and report the silence as a clean sweep. */
    gateOpen: function (ids) {
      var still = [];
      (ids || []).forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) { still.push(id + ':missing'); return; }
        if (el.hidden || (el.style && el.style.display === 'none')) return; /* held by the build */
        if (el.disabled) still.push(id + ':disabled');
      });
      return still;
    }
  };
}

/* ---------------------------------------------------------------- PART 1 */
function statics() {
  for (const shell of SHELLS) {
    const src = read(shell);
    ok(/function\s+showNote\s*\(/.test(src), `${shell}: showNote() is gone - the census seeds the note through it`);
    ok(/function\s+enableOutputs\s*\(/.test(src), `${shell}: enableOutputs() is gone - it owns the seventeen gated controls`);
    ok(/function\s+loadRecordIntoEditor\s*\(/.test(src), `${shell}: loadRecordIntoEditor() is gone - the restored-note half of the census runs through it`);
    for (const id of GATED_IDS) {
      ok(src.indexOf(`'${id}'`) >= 0 || src.indexOf(`"${id}"`) >= 0,
        `${shell}: the gated control ${id} is no longer named in the shell - the census would silently shrink`);
    }
    /* The held control must still be held, or its exclusion is stale. */
    ok(/id="imeBtn"[^>]*hidden/.test(src),
      `${shell}: #imeBtn is no longer held by the build, so excluding it from the census is now a stale exclusion`);
  }
  /* NO EXCLUSION IS SILENT, AND NONE MAY GO STALE. Both of the census's
     build-held controls rest on a rule that lives in 1p-mls-connect.js. The
     day either rule is removed, the control becomes reachable and must join
     the census - so the day either rule is removed, this fails. */
  const connect = read('1p-mls-connect.js');
  ok(connect.indexOf('"#emrBtn{display:none!important}"') >= 0,
    'the dock lane no longer hides #emrBtn, so holding the standalone EMR sections launcher out of the census is a stale exclusion');
  ok(/body\.ez3adv #noteCard button\[onclick\*="regenerateNote"\]/.test(connect),
    'the dock lane no longer hides Regenerate inside #noteCard, so holding it out of the census is a stale exclusion');
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
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = 'block';
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
    try { window.__mlsDeferAsset = (fn) => setTimeout(fn, 0); } catch (e) {}
    window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
    document.documentElement.classList.remove('mls-secure-loading');
    const g = document.getElementById('sfGateLoading');
    if (g && g.parentNode) g.parentNode.removeChild(g);
  });
  await page.evaluate(harness);
  const installNotes = await page.evaluate(() => window.__nc.errs());
  const seeded = await page.evaluate(() => window.__nc.seed());
  await page.evaluate(() => (typeof window.showView === 'function' ? window.showView('visit') : null));
  await page.waitForTimeout(1400);
  seeded.advanced = await page.evaluate(() => window.__nc.openAdvanced());
  await page.waitForTimeout(900);
  seeded.installNotes = installNotes;
  return seeded;
}

async function ambient(page, ms) {
  await page.evaluate(() => window.__nc.watchStart());
  await page.waitForTimeout(ms);
  const a = await page.evaluate(() => window.__nc.watchStop());
  await page.evaluate((keys) => window.__nc.setAmbient(keys), a.keys);
  return a.keys;
}

function evidenceOf(w, ambientSet) {
  const novel = w.keys.filter((k) => !ambientSet.has(k));
  const how = w.bridge > 0 ? 'athena-bridge'
    : w.dls > 0 ? 'download'
      : (w.navs > 0 || w.opens > 0) ? 'navigation'
        : w.asks > 0 ? 'refusal-or-ask'
          : novel.length > 0 ? 'visible-result'
            : w.busyDelta !== 0 ? 'busy' : 'nothing';
  return { how, any: how !== 'nothing', novel };
}

async function pressAndWatch(page, d) {
  await page.evaluate(() => { window.__nc.hookBridge(); window.__nc.watchStart(); });
  const did = await page.evaluate((x) => window.__nc.press(x), d);
  await page.waitForFunction(() => window.__nc.hasNovel(), null, { timeout: PRESS_WINDOW_MS, polling: 100 }).catch(() => {});
  const w = await page.evaluate(() => window.__nc.watchStop());
  const errs = await page.evaluate(() => window.__nc.errs());
  return { did, w, errs };
}

/* One control, judged. Never called dead on one silent press: the surface is
   re-sampled with nothing pressed and the control is pressed a second time. */
async function judge(page, d, amb) {
  let r = await pressAndWatch(page, d);
  if (r.did === 'not-found' || r.did === 'not-visible' || r.did === 'threw') {
    return { id: d.id || d.sel, what: d.what, did: r.did, how: 'nothing', alive: false, errs: r.errs };
  }
  let ev = evidenceOf(r.w, amb);
  if (!ev.any) {
    const amb2 = new Set(await ambient(page, 1500));
    const r2 = await pressAndWatch(page, d);
    const ev2 = evidenceOf(r2.w, amb2);
    if (ev2.any) { r = r2; ev = ev2; }
    await page.evaluate((keys) => window.__nc.setAmbient(keys), Array.from(amb));
  }
  return {
    id: d.id || d.sel, what: d.what, did: r.did, how: ev.how, alive: ev.any,
    said: (r.w.lastAsk || '').slice(0, 70), errs: r.errs
  };
}

async function census(page, label, amb) {
  const results = [];
  /* More tools is a fold: its controls are not on screen until it is open, and
     a census that never opens it would report sixteen controls missing. */
  await page.evaluate(() => {
    const mt = document.getElementById('moreTools');
    if (mt && getComputedStyle(mt).display === 'none') {
      const b = document.getElementById('moreToolsBtn');
      if (b) b.click();
    }
  });
  await page.waitForTimeout(500);
  for (const d of EXPECTED) {
    if (HELD[d.id] || d.held) continue;
    const rec = await judge(page, d, amb);
    rec.state = label;
    results.push(rec);
    await page.evaluate(() => window.__nc.dismiss());
    await page.waitForTimeout(160);
    /* A press can close the fold, close Advanced tools, or move the room;
       put the walk back before the next control, or every control after it
       reports not-visible and the census reads as a truncated sweep. */
    await page.evaluate(() => {
      try {
        const v = document.getElementById('visitView');
        if (typeof window.showView === 'function' && (!v || v.offsetParent === null)) window.showView('visit');
      } catch (e) {}
      try { if (document.body && !document.body.classList.contains('ez3adv')) document.body.classList.add('ez3adv'); } catch (e) {}
      try {
        const mt = document.getElementById('moreTools');
        if (mt && getComputedStyle(mt).display === 'none') {
          const b = document.getElementById('moreToolsBtn');
          if (b) b.click();
        }
      } catch (e) {}
    });
    await page.waitForTimeout(160);
  }
  return results;
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 980 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  try {
    const seeded = await boot(page, port);
    measured.seeded = seeded;
    ok(seeded && seeded.patients >= 8, `the synthetic roster did not land (${JSON.stringify(seeded)})`);
    ok(!!seeded.active, 'no patient is bound after seeding, so the visit room renders nothing to press');
    eq(seeded.advanced && seeded.advanced.noteCardVisible, true,
      `the visit review action surface (#noteCard) is not on screen after opening Advanced tools (${JSON.stringify(seeded.advanced)}) - every control would report not-visible and the census would prove nothing`);

    /* ---- PART A: the gate explains itself, measured AT REST -------------- */
    const atRest = {};
    for (const id of GATED_IDS) atRest[id] = await page.evaluate((d) => window.__nc.gateOf(d), { id });
    measured.atRest = atRest;

    eq(atRest.imeBtn.present, true, '#imeBtn is gone, so its held-exclusion is stale');
    ok(atRest.imeBtn.hidden || atRest.imeBtn.display === 'none',
      'the held #imeBtn is no longer hidden by the build, so excluding it from the census is now a stale exclusion');

    const unexplained = [];
    for (const id of GATED_IDS) {
      if (HELD[id]) continue;
      const g = atRest[id];
      if (!g.present) { unexplained.push(`${id}: not present in the shell`); continue; }
      if (!g.disabled && g.ariaDisabled !== 'true') continue; /* already on - nothing to explain */
      if (g.ariaDisabled !== 'true') { unexplained.push(`${id}: off with no aria-disabled, so a reader is not told it is off`); continue; }
      if (!g.title && !g.tip) { unexplained.push(`${id}: off with no hover reason in title or data-tip`); continue; }
      if (!g.reason) { unexplained.push(`${id}: off with no machine-readable data-mls-gate-reason`); continue; }
      if (g.reason.length < 24) { unexplained.push(`${id}: its reason is too short to explain anything: ${JSON.stringify(g.reason)}`); continue; }
    }
    measured.gatedAtRest = GATED_IDS.filter((id) => !HELD[id] && atRest[id].present && (atRest[id].disabled || atRest[id].ariaDisabled === 'true')).length;
    eq(unexplained.length, 0,
      'THESE CONTROLS ARE OFF AND DO NOT SAY WHY:\n    ' + unexplained.join('\n    '));

    /* One visible sentence, and one real next-action control, in the action
       row - not only a tooltip nobody hovers. */
    const notice = await page.evaluate(() => {
      const n = document.getElementById('noteActionGate');
      if (!n) return { present: false };
      const btn = n.querySelector('button,[role=button]');
      return {
        present: true, visible: window.__nc.visible(n),
        text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        nextAction: btn ? window.__nc.label(btn) : '', nextActionVisible: btn ? window.__nc.visible(btn) : false
      };
    });
    measured.gateNotice = notice;
    eq(notice.present, true, 'no #noteActionGate sentence exists, so the greyed-out action row explains itself only in tooltips');
    eq(notice.visible, true, 'the #noteActionGate sentence exists but is not visible while the actions are off');
    ok(notice.text.length > 20, `the #noteActionGate sentence is too short to explain anything: ${JSON.stringify(notice.text)}`);
    ok(!!notice.nextAction && notice.nextActionVisible,
      `the #noteActionGate offers no visible next-action control: ${JSON.stringify(notice)}`);

    /* Pressing the next action must itself answer. */
    const ambRest = new Set(await ambient(page, AMBIENT_MS));
    const nextRec = await judge(page, { sel: '#noteActionGate button', what: 'gate next action' }, ambRest);
    measured.gateNextAction = nextRec;
    eq(nextRec.alive, true, `the gate's own next-action control did nothing observable: ${JSON.stringify(nextRec)}`);

    /* ---- PART B: the census, generated note ----------------------------- */
    const gen = await page.evaluate(() => window.__nc.seedGenerated());
    measured.generatedSeed = gen;
    eq(gen.noteVisible, true, `the generated note did not land in #noteBox (${JSON.stringify(gen)}) - a census over a shell with no note presses nothing`);
    ok(gen.noteLength > 200, `the seeded generated note is too short to be a real note (${gen.noteLength} chars)`);
    eq(gen.provenance, 'generated_soap', 'the seeded note is not marked as a generated SOAP note');
    let stillOff = await page.evaluate((ids) => window.__nc.gateOpen(ids), GATED_IDS);
    measured.stillDisabledAfterGenerate = stillOff;
    eq(stillOff.length, 0, `showNote() ran but these controls are still disabled, so the census would press nothing: ${JSON.stringify(stillOff)}`);

    /* The gate sentence must stand DOWN once the actions are on: a permanent
       "these are off" line under a live action row is its own defect. */
    const noticeAfter = await page.evaluate(() => {
      const n = document.getElementById('noteActionGate');
      return n ? { present: true, visible: window.__nc.visible(n) } : { present: false };
    });
    measured.gateNoticeAfterGenerate = noticeAfter;
    ok(!noticeAfter.visible, 'the no-note gate sentence is still on screen after a note landed');

    const ambGen = new Set(await ambient(page, AMBIENT_MS));
    const genRows = await census(page, 'generated', ambGen);

    /* ---- PART B: the census, restored note ------------------------------ */
    const rest = await page.evaluate(() => window.__nc.seedRestored());
    measured.restoredSeed = rest;
    eq(rest.noteVisible, true, `the restored note did not land in #noteBox (${JSON.stringify(rest)})`);
    ok(rest.noteLength > 120, `the restored note is too short to be a real note (${rest.noteLength} chars)`);
    stillOff = await page.evaluate((ids) => window.__nc.gateOpen(ids), GATED_IDS);
    measured.stillDisabledAfterRestore = stillOff;
    eq(stillOff.length, 0, `loadRecordIntoEditor() ran but these controls are still disabled: ${JSON.stringify(stillOff)}`);

    const ambRestored = new Set(await ambient(page, AMBIENT_MS));
    const restRows = await census(page, 'restored', ambRestored);

    /* ---- THE VERDICT ---------------------------------------------------- */
    const rows = genRows.concat(restRows);
    measured.pressed = rows.length;
    const heldCount = EXPECTED.filter((e) => HELD[e.id] || e.held).length;
    measured.expected = (EXPECTED.length - heldCount) * 2;
    measured.held = EXPECTED.filter((e) => HELD[e.id] || e.held)
      .map((e) => (e.id || e.sel) + ': ' + (HELD[e.id] || e.held));
    measured.by = rows.reduce((a, r) => { a[r.how] = (a[r.how] || 0) + 1; return a; }, {});
    measured.perState = {
      generated: genRows.reduce((a, r) => { a[r.how] = (a[r.how] || 0) + 1; return a; }, {}),
      restored: restRows.reduce((a, r) => { a[r.how] = (a[r.how] || 0) + 1; return a; }, {})
    };

    eq(rows.length, measured.expected,
      `the census pressed ${rows.length} controls but ${measured.expected} were expected - it is not covering the surface`);

    const missing = rows.filter((r) => r.did === 'not-found' || r.did === 'not-visible');
    eq(missing.length, 0,
      'THESE EXPECTED CONTROLS WERE NOT ON THE SURFACE WITH A NOTE PRESENT:\n    '
      + missing.map((r) => `${r.id} "${r.what}" [${r.state}] -> ${r.did}`).join('\n    '));

    const threw = rows.filter((r) => r.did === 'threw' || (r.errs && r.errs.length));
    eq(threw.length, 0, `pressing these controls threw: ${JSON.stringify(threw.slice(0, 8).map((r) => r.id + ' :: ' + (r.errs || []).join('|')))}`);

    const dead = rows.filter((r) => !r.alive);
    measured.dead = dead.length;
    eq(dead.length, 0,
      'A NOTE IS ON SCREEN AND PRESSING THESE PRODUCED NOTHING - NO RESULT, NO REFUSAL, NO NAVIGATION, NO DOWNLOAD, NO ATHENA BRIDGE:\n    '
      + dead.map((r) => `${r.id}  "${r.what}"  [${r.state}]`).join('\n    '));

    /* The Athena bridge is not optional: "Review Athena actions" is the last
       step of the visit and it must reach the write-flow, not merely repaint. */
    const bridged = rows.filter((r) => r.id === 'pushAllEmrBtn' && r.how === 'athena-bridge');
    measured.athenaBridgeRows = rows.filter((r) => r.id === 'pushAllEmrBtn').map((r) => r.state + ':' + r.how);
    ok(bridged.length >= 1,
      `"Review Athena actions" never reached the write-flow bridge in either note state: ${JSON.stringify(measured.athenaBridgeRows)}`);

    eq(pageErrors.length, 0, `the shell raised ${pageErrors.length} page errors during the census: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

statics();
runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured, null, 1));
  console.log(`1p-generated-note-action-census: ${checks} checks passed`);
}).catch((e) => {
  console.error('MEASURED ' + JSON.stringify(measured, null, 1));
  console.error('1p-generated-note-action-census FAILED: ' + (e && e.message));
  process.exit(1);
});
