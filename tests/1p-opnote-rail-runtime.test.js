/* CAUSAL CONTROL PIN (2026-08-17): the control engine is the pre-fix commit
   1e0151a4 (main before batch 7), NOT the moving origin/main — once this ships,
   origin/main carries it and a control against it would prove nothing. */
'use strict';

/* /1p OP NOTES — THE DAY IS A RAIL, THE NOTE IS THE ROOM (opnote-day-3.0.0)
 *
 * Owner, 2026-08-18, after two rebuilds of this room: "I hate the new OP NOTES
 * EVEN MORE. FIX. That LEFT SIDE SELECTOR THING was great — add it back. Add
 * the left side thing back and do a NEW UI for main op notes and MAKE SURE IT
 * WORKS."
 *
 * "The left side selector thing" is production's own #oprDayRail — the left
 * column of #oprPanelProcs, carrying one button per patient for the day.
 * opnote-day-1.0.0 folded it; 2.0.0 replaced the whole room with a single
 * column that was a LIST or ONE PATIENT and never both, so choosing the next
 * patient meant leaving the one you were on. 3.0.0 puts the rail back and
 * keeps every earlier ruling.
 *
 * WHAT THIS SUITE PROVES, as properties a machine can check:
 *
 *   1.  THE RAIL. #oprDayRail is on screen in every mode and carries exactly
 *       one button per scheduled patient — the same patients, in the same
 *       order, that the app's own _opApptsForDay() returns. Two panes at 1440,
 *       1280 and 1024; a top strip at 768 and 390, and the list is never lost.
 *   2.  NOTHING IS SELECTED ON OPEN. "Always start on all scheduled patients"
 *       (owner, twice): the rail shows the whole day and the right pane says
 *       what to do — no patient is chosen for him, and no editor is on screen.
 *   3.  A BUTTON OPENS THAT PATIENT'S NOTE, EXPANDED, beside the rail: bound
 *       to that patient, that day and that appointment id, with the green
 *       PROCEDURE hero gone and nothing to click first.
 *   4.  THE FORMATTED VIEW STARTS HIDDEN on every open, and its own control
 *       opens it.
 *   5.  THE DAY SWITCHES EASILY and re-lists: arrows, the picker, Today, and
 *       the left/right keys.
 *   6.  EXACTLY ONE GLOWING CONTROL, AND IT IS THE RIGHT ONE, driven through
 *       the real state machine: no note -> drafted -> saved. The glow is
 *       nextglow-1.0.0's and no other, and this block only names the id.
 *   7.  ONE TEMPLATES HOP. The room renders no library of its own.
 *   8.  SIZES: no horizontal overflow, no control covered by the taskbar, 40px
 *       tap targets, and the room opens at its own top.
 *   9.  KEYBOARD: left/right move patients on a note and days on the rail;
 *       Esc goes back to the day and only a second Esc leaves the room.
 *  10.  Both twins carry the block byte-identically.
 *  11.  CAUSAL CONTROL: the same instrument against the pre-fix shell, so
 *       every number above is attributable to this block, not to the harness.
 *
 * No login, no network, no PHI — synthetic names only.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const PREFIX = '1e0151a4864b696b2934ffcabf88a95e9716e593';
const DAY = '2026-08-17';        /* 17 patients */
const DAY_NEXT = '2026-08-18';   /* 3 patients  */
const DAY_PREV = '2026-08-16';   /* none        */
const N_DAY = 17;

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ===================================================== PART 1: static ===== */
{
  const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');
  const OPEN = '<!-- ===== opnote-day-3.0.0';
  const CLOSE = '<!-- ===== end opnote-day-3.0.0';
  const a = read('1pScribeFlow.html');
  const b = read('1p/index.html');
  for (const [name, src] of [['1pScribeFlow.html', a], ['1p/index.html', b]]) {
    eq(src.split(OPEN).length - 1, 1, `${name}: the block must open exactly once`);
    eq(src.split(CLOSE).length - 1, 1, `${name}: the block must close exactly once`);
    const span = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));
    /* the room's own generator calls are DRIVEN, never re-implemented: this
       block must never build its own AI request, its own save, or its own
       Athena write */
    for (const forbidden of ['aiCallRaw', 'fetch(', '_genOpNote', 'saveNotes(', 'getNotes()[']) {
      ok(span.indexOf(forbidden) < 0,
        `${name}: the op-note room block calls ${forbidden} — it must drive the app's own controls, never re-implement drafting, saving or the Athena write`);
    }
    /* and it must not weaken the day-brain's safety filter */
    ok(!/markSolo|statesNoProcedure|PROC_WORD|verdict\s*=\s*'needs'/.test(span),
      `${name}: the op-note room block reaches into the day-brain's triage`);
    /* THE NEVER-FOLDED SET, and #oprDayRail is now IN it. 1.0.0 and 2.0.0
       folded the rail; the owner has ruled the other way. */
    for (const never of ['#opPrepGenAllBtn', '#tpfStop', '.modal-x', '#oprBack', '#oprDayRail']) {
      ok(!new RegExp("sel: '" + never.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(span),
        `${name}: the block folds ${never} through its registry, which must never happen`);
    }
    /* THE COMMENTS MUST CLOSE. This block is mostly prose, and an edit that
       drops a comment OPENER while keeping its terminator leaves stray text in
       the STYLESHEET — which silently kills the rule that follows it. MEASURED
       twice in one afternoon: once it took the Fields box's animation guard
       out, once it took the re-entrancy note's own rule with it. Counting the
       two markers is enough to catch it, and it costs nothing. */
    const styleTxt = span.slice(span.indexOf('<style'), span.indexOf('</style>'));
    eq((styleTxt.match(/\/\*/g) || []).length, (styleTxt.match(/\*\//g) || []).length,
      `${name}: the op-note room's stylesheet has unbalanced comment markers — a stray terminator leaves prose in the CSS and kills the next rule`);
    /* the state attribute the guided-glow lane consumes */
    ok(span.indexOf('data-mls-opnotes-state') > 0, `${name}: the block no longer exposes its room state`);
    ok(span.indexOf('data-mls-opnotes-next') > 0, `${name}: the block no longer exposes its next control`);

    /* ONE HIGHLIGHT SYSTEM. Owner, 2026-08-18: "it always highlights the wrong
       box — why would it highlight templates." The room must NAME the next
       step and nextglow-1.0.0 must be the only thing that marks one. */
    /* WRITES, not mentions: the block is allowed to EXPLAIN the halo (it has
       to, to justify pointing at a button rather than an input), but it must
       never mark one. */
    ok(!/setAttribute\(\s*'data-mls-next'|classList\.add\(\s*'msl-next'/.test(span),
      `${name}: the op-note room marks a glow of its own — there must be exactly one highlight owner`);
    /* ... and the nextglow table must actually consult it, per state. The row
       is read out of the shipped shell rather than assumed. */
    const ng = src.slice(src.indexOf('<!-- ===== nextglow-1.0.0'), src.indexOf('<!-- ===== end nextglow-1.0.0'));
    ok(/function opnWant\(\)/.test(ng),
      `${name}: nextglow no longer asks the op-note room which surface is up — it is guessing again`);
    for (const id of ['mlsOpnHist', 'tpfStop', 'mlsOpnGo', 'mlsOpnPull', 'opPrepGenAllBtn', 'mlsOpDayGo']) {
      ok(new RegExp("opnWant\\(\\) === '" + id + "'").test(ng),
        `${name}: nextglow's opnotes row has no state for ${id}`);
    }
    /* the hop that lit the wrong box must stay gone */
    ok(!/unblock:\s*'#oprTabTpls'/.test(ng),
      `${name}: the Templates unblock hop is back in the glow ladder — that is the box the owner said was wrong`);
  }
  /* 10. the twins carry the same block, byte for byte */
  const sliceOf = (s) => s.slice(s.indexOf(OPEN), s.indexOf(CLOSE) + CLOSE.length);
  eq(sliceOf(a), sliceOf(b), 'the twins carry different opnote-day-3.0.0 blocks');
}

/* ==================================================== PART 2: runtime ===== */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve(shellFile) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = (p === '/1pScribeFlow.html' && shellFile) ? shellFile : path.resolve(root, '.' + p);
      if (!shellFile && !file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected into the page. Synthetic names only. */
function harness(days) {
  var DAY = days.DAY, DAY_NEXT = days.DAY_NEXT;
  var NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample',
    'Gus Sample', 'Hal Sample', 'Ivy Sample', 'Jo Sample', 'Kit Sample', 'Lu Sample',
    'Max Sample', 'Nia Sample', 'Oz Sample', 'Pia Sample', 'Quin Sample'];
  var LATER = ['Yas Sample', 'Zed Sample', 'Ann Sample'];
  var PROCS = ['Lumbar medial branch block', 'Right L4-L5 transforaminal epidural steroid injection',
    'Radiofrequency ablation, lumbar facet', 'Sacroiliac joint injection'];

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }
  function pt(n, i) {
    return { id: 'syn-' + i, name: n, dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
      mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: [] };
  }
  function rect(e) {
    if (!e) return null;
    var r = e.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      bottom: Math.round(r.bottom), right: Math.round(r.right) };
  }

  window.__opn = {
    visible: visible,
    rect: rect,
    /* Two days of real appointments and one day with none, so "all the
       scheduled patients of the day" is a claim with three cases. */
    seed: function () {
      var all = NAMES.concat(LATER), out = {};
      try {
        setTemplates(PROCS.map(function (p, i) {
          return { id: 'syn-t' + i, name: p, body: 'PROCEDURE: ' + p + '\nFINDINGS: [[findings]]', kind: 'op' };
        }));
        localStorage.setItem(uns('useTemplates'), '1');
      } catch (e) { out.tplErr = String(e && e.message); }
      try { savePatients(all.map(pt)); out.patients = getPatients().length; }
      catch (e2) { out.ptErr = String(e2 && e2.message); }
      var appts = NAMES.map(function (n, i) {
        return { id: 'appt-' + i, name: n, patientId: 'syn-' + i, patient_external_id: 'syn-' + i,
          appt_date: DAY, start_at: DAY + 'T' + (8 + (i % 9) < 10 ? '0' : '') + (8 + (i % 9)) + ':' + (i % 2 ? '30' : '00') + ':00',
          reason: PROCS[i % PROCS.length], providerName: 'Sample Provider, MD' };
      }).concat(LATER.map(function (n, k) {
        var i = NAMES.length + k;
        return { id: 'appt-' + i, name: n, patientId: 'syn-' + i, patient_external_id: 'syn-' + i,
          appt_date: DAY_NEXT, start_at: DAY_NEXT + 'T1' + k + ':00:00',
          reason: PROCS[k % PROCS.length], providerName: 'Sample Provider, MD' };
      }));
      window._calAppts = appts;
      /* The schedule-import ledger _opVisitStamp reads to resolve a REAL
         Athena appointment id. Without it the binding half of this suite
         would only ever prove "the id is empty on both sides". */
      try {
        var rows = {};
        NAMES.forEach(function (n, i) {
          rows['appointment-id:' + (5550000 + i)] = { patientId: 'syn-' + i, backendAppointmentId: 'appt-' + i, appt_date: DAY };
        });
        localStorage.setItem(uns('schedImportIndexV1::' + DAY), JSON.stringify({ rows: rows }));
      } catch (e3) { out.ledgerErr = String(e3 && e3.message); }
      out.appts = appts.length;
      try { renderPatients(); } catch (e4) {}
      return out;
    },
    /* the app's OWN answer to "who is scheduled on this day" */
    scheduled: function (day) {
      try { return (window._opApptsForDay(day) || []).map(function (a) { return a.name; }); }
      catch (e) { return null; }
    },
    open: function (day) { try { window.openOpPrep(day); } catch (e) {} },

    /* ---- THE ROOM'S SHAPE, MEASURED --------------------------------- */
    /* Everything visible in the room that is NOT a per-patient rail button,
       split by which pane it is in — because "the rail is busy" and "the note
       is busy" are different complaints with different budgets. */
    shape: function () {
      var modal = document.getElementById('opPrepModal');
      if (!modal) return null;
      var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button],' +
        '[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=tab]';
      var railHost = document.getElementById('oprDayRail');
      var editor = document.getElementById('oprEditor');
      var all = Array.prototype.slice.call(modal.querySelectorAll(CTRL)).filter(visible);
      var notRow = all.filter(function (e) { return !(e.closest && e.closest('.mlsOpDayCard')); });
      var name = function (e) {
        return e.id || (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26) || e.tagName;
      };
      var panel = document.getElementById('oprPanelProcs');
      return {
        state: String(modal.getAttribute('data-mls-opnotes-state') || ''),
        next: String(modal.getAttribute('data-mls-opnotes-next') || ''),
        n: notRow.length,
        ids: notRow.map(name),
        railN: notRow.filter(function (e) { return railHost && railHost.contains(e); }).length,
        railIds: notRow.filter(function (e) { return railHost && railHost.contains(e); }).map(name),
        paneN: notRow.filter(function (e) { return editor && editor.contains(e); }).length,
        paneIds: notRow.filter(function (e) { return editor && editor.contains(e); }).map(name),
        rows: Array.prototype.slice.call(modal.querySelectorAll('.mlsOpDayCard')).filter(visible).length,
        editors: Array.prototype.slice.call(modal.querySelectorAll('#opPrepList > div')).filter(visible).length,
        railShown: !!(railHost && visible(railHost)),
        railOwnsList: !!(railHost && document.getElementById('mlsOpnRail') && railHost.contains(document.getElementById('mlsOpnRail'))),
        cols: panel ? getComputedStyle(panel).gridTemplateColumns : '',
        railRect: rect(railHost), editorRect: rect(editor),
        overflow: document.documentElement.scrollWidth - window.innerWidth
      };
    },
    /* the rail's buttons as the doctor reads them */
    listed: function () {
      return Array.prototype.slice.call(document.querySelectorAll('#mlsOpDayGrid .mlsOpDayCard')).map(function (c) {
        return {
          i: +c.getAttribute('data-mls-card-i'),
          name: (c.querySelector('.mlsOpDayName') || {}).textContent || '',
          time: (c.querySelector('.mlsOpDayTime') || {}).textContent || '',
          proc: (c.querySelector('.mlsOpDayProc') || {}).textContent || '',
          state: c.getAttribute('data-mls-cardstate') || '',
          chip: (c.querySelector('.mlsOpDayChip') || {}).textContent || '',
          why: (c.querySelector('.mlsOpDayWhy') || {}).textContent || '',
          dot: !!c.querySelector('.mlsOpDayDot'),
          current: c.getAttribute('aria-current') === 'true',
          h: Math.round(c.getBoundingClientRect().height)
        };
      });
    },
    /* press a rail button the way a doctor does */
    pressRow: function (i) {
      var b = document.getElementById('mlsOpnRow' + i);
      if (!b) return false;
      b.click();
      return true;
    },
    press: function (id) { var b = document.getElementById(id); if (!b) return false; b.click(); return true; },
    seen: function (sel) { var e = document.querySelector(sel); return !!(e && visible(e)); },
    /* the identity the note pane is bound to, read off the app's own stamp
       rather than off this block */
    binding: function () {
      var d = (window.__mlsOpDay ? window.__mlsOpDay.selected() : -1);
      var row = (window._opPrep || [])[d];
      if (!row) return null;
      var p = null;
      try { p = (getPatients() || []).filter(function (x) { return x.id === row.patientId; })[0] || null; } catch (e) {}
      var stamp = null;
      try { stamp = window._opVisitStamp(row, p); } catch (e2) { stamp = null; }
      return { sel: d, name: String(row.appt && row.appt.name || ''), patientId: String(row.patientId || ''),
        dateKey: String(row.dateKey || ''), stamp: stamp };
    },
    /* WHAT IS COVERED, AND BY WHAT. A rect is not a click: a control can be
       perfectly positioned and still sit under a fixed chip that paints over
       it, so this asks document.elementFromPoint at the point each control
       would actually be pressed. */
    /* SCROLLED OUT OF ITS OWN SCROLLER IS NOT COVERED. A control below the
       fold of a scrolling container still has a laid-out rect at that
       position, so document.elementFromPoint there returns whatever the NEXT
       surface paints — and a naive probe reports every row below the fold as
       "painted over". MEASURED: at 768x1024 the rail is a 389px top strip with
       17 patients in it, and rows 9-16 were scored as occluded by #mlsOpnPick
       and #oprEditor while being perfectly reachable with one scroll. A
       control is only occluded if its own scrollers do NOT clip it there. */
    clippedByScroller: function (e, r) {
      var n = e.parentNode;
      while (n && n.nodeType === 1 && n !== document.body) {
        var cs = getComputedStyle(n);
        if (/auto|scroll|hidden/.test(cs.overflowY) || /auto|scroll|hidden/.test(cs.overflowX)) {
          var sr = n.getBoundingClientRect();
          if (r.bottom <= sr.top + 1 || r.top >= sr.bottom - 1 ||
              r.right <= sr.left + 1 || r.left >= sr.right - 1) return true;
        }
        n = n.parentNode;
      }
      return false;
    },
    occluded: function () {
      var modal = document.getElementById('opPrepModal');
      var out = [];
      if (!modal) return out;
      var self = this;
      modal.querySelectorAll('button,input,select,textarea,a[href]').forEach(function (e) {
        if (!visible(e)) return;
        var r = e.getBoundingClientRect();
        if (self.clippedByScroller(e, r)) return;
        var x = Math.round(r.left + r.width / 2);
        var y = Math.round(r.top + Math.min(r.height / 2, 12));
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
        var hit = document.elementFromPoint(x, y);
        if (!hit || hit === e || e.contains(hit) || hit.contains(e)) return;
        out.push({ id: e.id || (e.textContent || '').trim().slice(0, 18) || e.tagName,
          y: Math.round(r.top), under: hit.id || String(hit.className || '').slice(0, 24) || hit.tagName });
      });
      return out;
    },
    /* every visible control in the room whose short side is under `floor` */
    smallTargets: function (floor) {
      var modal = document.getElementById('opPrepModal');
      var out = [];
      if (!modal) return out;
      modal.querySelectorAll('button,input:not([type=hidden]),select,textarea,[role=button]').forEach(function (e) {
        if (!visible(e)) return;
        var r = e.getBoundingClientRect();
        var short = Math.min(r.width, r.height);
        if (short < floor) out.push({ id: e.id || (e.textContent || '').trim().slice(0, 18) || e.tagName,
          w: Math.round(r.width), h: Math.round(r.height) });
      });
      return out;
    },
    /* ---- IS THE ROOM CALM? ------------------------------------------
       Owner, 2026-08-18: "the whole op notes thing is bugging out like crazy."
       Counted inside #opPrepModal only, over a real wall-clock window, with
       the scroll positions of every scroller in the room sampled at 10 Hz and
       an animation census taken at the end.

       MEASURED BEFORE, at f1efb4a2 (opnote-day-2.0.0), 17-patient day, room at
       rest for 10 s: 31,150 mutations = 3,113/s, of which 30,940 were `class`
       on .msl-more (18,594), #oprDayRail (6,188) and #mlsOnfBar (6,188) —
       the fold registry rewriting its own classes into its own observer. */
    watch: function (ms) {
      var m = document.getElementById('opPrepModal');
      if (!m) return Promise.resolve(null);
      var counts = { total: 0, childList: 0, attributes: 0, characterData: 0 };
      var byTarget = {}, byAttr = {};
      /* THE LANE'S OWN SURFACES, counted separately. The room is shared: the
         fill module's counter, the day-brain's banner and the room module's
         template-mode picker all live in #opPrepModal and keep their own
         cadences. Attributing every record in the modal to opnote-day would be
         the same mistake as blaming it for none of them. */
      var mine = 0;
      var own = ['mlsOpnRail', 'mlsOpnNote', 'mlsOpnPick'].map(function (id) { return document.getElementById(id); }).filter(Boolean);
      var isMine = function (n) {
        for (var k = 0; k < own.length; k++) { if (own[k] === n || own[k].contains(n)) return true; }
        return false;
      };
      var mo = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i];
          counts.total++; counts[r.type]++;
          var t = r.target;
          if (t && isMine(t.nodeType === 1 ? t : (t.parentNode || t))) mine++;
          var key = (t.nodeType === 1
            ? (t.id ? '#' + t.id : (t.className ? '.' + String(t.className).split(/\s+/)[0] : t.tagName))
            : '#text');
          byTarget[key] = (byTarget[key] || 0) + 1;
          if (r.type === 'attributes') byAttr[r.attributeName] = (byAttr[r.attributeName] || 0) + 1;
        }
      });
      mo.observe(m, { childList: true, subtree: true, attributes: true, characterData: true });
      var scrollers = ['opPrepModal', 'oprEditor', 'oprDayRail', 'oprPanelProcs', 'mlsOpDayList']
        .map(function (id) { return document.getElementById(id); }).filter(Boolean);
      var seen = scrollers.map(function (n) { return { id: n.id, last: null, vals: {} }; });
      var jumps = [], samples = 0;
      var iv = setInterval(function () {
        samples++;
        for (var i = 0; i < scrollers.length; i++) {
          var v = Math.round(scrollers[i].scrollTop);
          seen[i].vals[v] = (seen[i].vals[v] || 0) + 1;
          if (seen[i].last !== null && seen[i].last !== v) jumps.push(seen[i].id + ':' + seen[i].last + '->' + v);
          seen[i].last = v;
        }
      }, 100);
      var t0 = Date.now();
      return new Promise(function (res) {
        setTimeout(function () {
          mo.disconnect(); clearInterval(iv);
          var secs = (Date.now() - t0) / 1000;
          /* THE ANIMATION CENSUS IS getAnimations(), NOT COMPUTED STYLE. A
             FINISHED one-shot still reports its animation-name in computed
             style, so a computed-style census scores the room's own entrance
             as "running" forever. playState is the truth. */
          var anims = [];
          try {
            (document.getAnimations ? document.getAnimations() : []).forEach(function (a) {
              if (a.playState !== 'running') return;
              var t = a.effect && a.effect.target;
              if (!t || t.nodeType !== 1) return;
              if (!m.contains(t)) return;
              anims.push({ id: t.id || String(t.className || '').slice(0, 26) || t.tagName,
                pseudo: (a.effect && a.effect.pseudoElement) || '',
                next: t.getAttribute && t.getAttribute('data-mls-next') === '1' });
            });
          } catch (e) {}
          res({ secs: Math.round(secs * 10) / 10, total: counts.total,
            perSec: Math.round((counts.total / secs) * 10) / 10,
            mine: mine, minePerSec: Math.round((mine / secs) * 10) / 10,
            byType: counts,
            topTargets: Object.keys(byTarget).sort(function (a, b) { return byTarget[b] - byTarget[a]; })
              .slice(0, 6).map(function (k) { return k + '=' + byTarget[k]; }),
            attrs: Object.keys(byAttr).sort(function (a, b) { return byAttr[b] - byAttr[a]; })
              .slice(0, 6).map(function (k) { return k + '=' + byAttr[k]; }),
            scrollSamples: samples, jumps: jumps.slice(0, 8), jumpN: jumps.length,
            anims: anims });
        }, ms);
      });
    },
    /* DOES THE PANE RE-MOUNT? Node identity across N forced repaints — the
       repaint the app itself does on every keystroke while a draft streams. */
    identity: function (n) {
      var ids = ['mlsOpnRail', 'mlsOpnNote', 'mlsOpnGo', 'mlsOpnName', 'mlsOpDay', 'mlsOpDayGrid',
        'mlsOpnRow0', 'opPrepGenAllBtn', 'mlsOpnPick'];
      var first = {};
      ids.forEach(function (id) { first[id] = document.getElementById(id); });
      for (var k = 0; k < n; k++) {
        try { opPrepRender(); } catch (e) {}
        try { window.__mlsOpDay.refresh(); } catch (e) {}
      }
      return new Promise(function (res) {
        setTimeout(function () {
          var out = {};
          ids.forEach(function (id) {
            var now = document.getElementById(id);
            out[id] = !first[id] ? 'absent-before' : (now === first[id] ? 'same' : (now ? 'REMOUNTED' : 'GONE'));
          });
          res(out);
        }, 900);
      });
    },
    /* The Fields box the owner said "flashes back and forth", and whether
       anything inside it is animating while a field still needs a value. */
    fieldsBox: function () {
      var cur = document.querySelector('#opPrepList > div.opr-cur');
      var box = cur ? cur.querySelector('.onf-fillbox') : null;
      if (!box) return { box: false };
      var out = { box: true, vis: visible(box), cls: String(box.className), anim: [], glow: [] };
      var nodes = [box].concat(Array.prototype.slice.call(box.querySelectorAll('*')));
      nodes.forEach(function (e) {
        /* THE ONE CONTROL THAT IS ALLOWED TO MOVE. The contract is "the only
           animated thing in the room is the single next step" — so the glowing
           control is counted separately rather than scored as a violation of
           the rule it is the exception to. */
        if (e.getAttribute && e.getAttribute('data-mls-next') === '1') {
          out.glow.push(e.id || String(e.className || '').slice(0, 22) || e.tagName);
          return;
        }
        ['', '::before', '::after'].forEach(function (ps) {
          var cs = getComputedStyle(e, ps || null);
          if (cs && cs.animationName && cs.animationName !== 'none') {
            out.anim.push((e.id || String(e.className || '').slice(0, 22) || e.tagName) + ps + ':' + cs.animationName);
          }
          if (cs && cs.transitionProperty && cs.transitionProperty !== 'none' && cs.transitionProperty !== 'all'
            && parseFloat(cs.transitionDuration) > 0) {
            out.anim.push((e.id || String(e.className || '').slice(0, 22) || e.tagName) + ps + ':transition ' + cs.transitionProperty);
          }
        });
      });
      out.needs = box.querySelectorAll('label:not(.onf-has)').length;
      out.filled = box.querySelectorAll('label.onf-has').length;
      /* the running animations by playState, inside this box only */
      out.running = [];
      try {
        (document.getAnimations ? document.getAnimations() : []).forEach(function (a) {
          if (a.playState !== 'running') return;
          var t = a.effect && a.effect.target;
          if (!t || t.nodeType !== 1 || !box.contains(t)) return;
          if (t.getAttribute && t.getAttribute('data-mls-next') === '1') return;   /* the glow */
          out.running.push(t.id || t.tagName);
        });
      } catch (e) {}
      return out;
    },
    /* what nextglow-1.0.0 actually lit, and what the room says it should be */
    glow: function () {
      var r = window.__mlsNextGlow ? window.__mlsNextGlow.report() : null;
      return { room: r && r.room, count: r ? r.count : -1,
        lit: r && r.lit.map(function (l) { return l.id + (l.visible ? '' : '(hidden)') + (l.enabled ? '' : '(disabled)'); }),
        id: (r && r.lit[0] && r.lit[0].id) || '',
        want: window.__mlsOpDay ? window.__mlsOpDay.glow() : '',
        state: window.__mlsOpDay ? window.__mlsOpDay.state() : '' };
    }
  };
}

async function bootShell(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  /* THE STEP WITHOUT WHICH THIS SUITE MEASURES A BARE SHELL: 1p-mls-connect.js
     and all 219 feature modules ride a gate only a login normally opens. */
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    /* .modal sits at opacity 0 in a non-compositing tab */
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
  });
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'opnote-rail@mlsscribe.test'; });
}

/* Wait for nextglow to settle on ONE lit control and hold it for two samples.
   The glow re-resolves on the app's own cadence, and a snapshot taken mid
   transition is a measurement of timing, not of the contract. */
async function settleGlow(page, tries = 16) {
  let prev = '', g = null;
  for (let i = 0; i < tries; i++) {
    g = await page.evaluate(() => window.__opn.glow());
    const sig = g.count + '|' + (g.lit || []).join(',') + '|' + g.want;
    if (sig === prev && g.count === 1) return g;
    prev = sig;
    await page.waitForTimeout(350);
  }
  return g;
}

async function runtime() {
  const { srv, port } = await serve(null);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  try {
    await bootShell(page, `http://127.0.0.1:${port}/1pScribeFlow.html`);
    await page.evaluate(harness, { DAY, DAY_NEXT });
    const seeded = await page.evaluate(() => window.__opn.seed());
    eq(seeded.patients, 20, `the synthetic roster did not land: ${JSON.stringify(seeded)}`);
    eq(seeded.appts, 20, `the synthetic schedule did not land: ${JSON.stringify(seeded)}`);
    /* Automatic drafting is the app's own behaviour and is proven by
       1p-ui-shape-contract; here it would make every status non-deterministic
       (there is no backend, so every draft fails). Turned off for this run
       ONLY, and its precondition is asserted directly below instead. */
    await page.evaluate(() => { try { window.__mlsAutoDraft.setEnabled(false); } catch (e) {} });
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));

    /* ================================================================
     * 1. THE RAIL IS THE DAY — ALL OF IT, ON THE LEFT
     * ============================================================== */
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(2200);
    const expected = await page.evaluate((d) => window.__opn.scheduled(d), DAY);
    ok(Array.isArray(expected) && expected.length === N_DAY,
      `the app's own _opApptsForDay returned ${expected && expected.length} rows for the ${N_DAY}-patient day — the premise of this suite`);
    let listed = await page.evaluate(() => window.__opn.listed());
    assert.deepStrictEqual(listed.map((r) => r.name), expected,
      `the rail lists ${listed.length} patients for a day the app says has ${expected.length}, or lists them in a different order`);
    checks++;
    let shape = await page.evaluate(() => window.__opn.shape());
    measured.rail = shape;
    eq(shape.railShown, true, 'the left-side patient rail is not on screen — that is the thing the owner asked to have back');
    eq(shape.railOwnsList, true,
      "the rail's patient list is not inside #oprDayRail — it is not production's own left column any more");
    eq(shape.rows, N_DAY, `the rail shows ${shape.rows} of ${N_DAY} patient buttons`);
    /* TWO PANES, and the rail really is to the LEFT of the note */
    ok(/^288px /.test(shape.cols),
      `#oprPanelProcs is "${shape.cols}" at 1440 — the rail must keep its own column (msl-fit collapses it below 1100px, which is what this re-asserts)`);
    ok(shape.railRect.x < shape.editorRect.x,
      `the rail is at x=${shape.railRect.x} and the note pane at x=${shape.editorRect.x} — the selector must be on the LEFT`);
    ok(shape.railRect.right <= shape.editorRect.x + 1,
      `the rail (right edge ${shape.railRect.right}) overlaps the note pane (left edge ${shape.editorRect.x})`);
    /* every button carries what the owner asked for */
    for (const r of listed.slice(0, 5)) {
      ok(/\d/.test(r.time), `a rail button shows no appointment time: ${JSON.stringify(r)}`);
      ok(r.name.trim().length > 0, `a rail button shows no patient name: ${JSON.stringify(r)}`);
      ok(r.proc.trim().length > 0, `a rail button shows no procedure line: ${JSON.stringify(r)}`);
      ok(r.chip.trim().length > 0, `a rail button shows no status word: ${JSON.stringify(r)}`);
      ok(r.dot, `a rail button has no status dot: ${JSON.stringify(r)}`);
    }
    /* every button the same height: a wrapped line is what made the previous
       grid ragged, and a ragged rail is hard to scan */
    const heights = listed.map((r) => r.h);
    const spread = Math.max.apply(null, heights) - Math.min.apply(null, heights);
    ok(spread <= 2,
      `the rail buttons span ${spread}px of height (${JSON.stringify(Array.from(new Set(heights)))}) — every one must be the same height. 2px is sub-pixel line rounding; one wrapped line is ~16px.`);
    measured.buttonHeight = Math.max.apply(null, heights) + 'px (spread ' + spread + 'px)';

    /* THE AUTODRAFT PRECONDITION, and the one-primary rule together.
       msl-autodraft refuses when #opPrepGenAllBtn.offsetParent is null, so the
       button had to be MOVED into the rail rather than copied — a copy would
       be two Draft-all buttons and folding the original would turn automatic
       drafting off silently. */
    const gen = await page.evaluate(() => {
      const b = document.getElementById('opPrepGenAllBtn');
      const act = document.getElementById('mlsOpnRailAct');
      return { present: !!b, offsetParent: !!(b && b.offsetParent), text: b ? b.textContent : '',
        inRail: !!(b && act && b.parentNode === act),
        copies: document.querySelectorAll('#opPrepModal [id="opPrepGenAllBtn"]').length,
        draftAlls: Array.from(document.querySelectorAll('#opPrepModal button'))
          .filter(window.__opn.visible).filter((e) => /draft all/i.test(e.textContent || '')).length };
    });
    ok(gen.offsetParent,
      `#opPrepGenAllBtn has a null offsetParent on the rail — msl-autodraft would report "button-unavailable" and never start: ${JSON.stringify(gen)}`);
    eq(gen.inRail, true, `the Draft-all primary is not in the rail: ${JSON.stringify(gen)}`);
    eq(gen.draftAlls, 1, `the room shows ${gen.draftAlls} "Draft all" buttons — there must be exactly one`);
    ok(new RegExp(String(N_DAY)).test(gen.text),
      `the Draft-all button does not say how many notes the day needs: "${gen.text}"`);

    /* opnote-day-3.0.1 — owner 2026-08-18: "there is no Templates button".
       The room's top bar (and its Templates tab) is hidden outside the
       templates state, so the rail carries ONE plain Templates button that
       calls the shell's own openTemplates(). Visible from the day list, ≥40px,
       not a glow candidate, and pressing it reaches the templates state. */
    const tplBtn = await page.evaluate(async () => {
      const b = document.getElementById('mlsOpnRailTpl');
      const act = document.getElementById('mlsOpnRailAct');
      const out = { present: !!b, visible: !!(b && window.__opn.visible(b)), inRail: !!(b && act && b.parentNode === act),
        h: b ? Math.round(b.getBoundingClientRect().height) : 0, text: b ? (b.textContent || '').trim() : '',
        lit: !!(b && b.matches('.mls-nextglow, [data-mls-nextglow="1"]')) };
      if (b) {
        b.click();
        await new Promise((r) => setTimeout(r, 900));
        out.stateAfter = document.getElementById('opPrepModal') ? document.getElementById('opPrepModal').getAttribute('data-mls-opnotes-state') : null;
        out.panelOn = !!(document.getElementById('oprPanelTpls') && document.getElementById('oprPanelTpls').classList.contains('on'));
        /* come back to the day for the rest of the suite */
        try { const tab = document.getElementById('oprTabProcs'); if (tab) tab.click(); } catch (e) {}
        try { if (window.__mlsOpDay && typeof window.__mlsOpDay.showDay === 'function') window.__mlsOpDay.showDay(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 700));
        out.stateBack = document.getElementById('opPrepModal') ? document.getElementById('opPrepModal').getAttribute('data-mls-opnotes-state') : null;
      }
      return out;
    });
    ok(tplBtn.present && tplBtn.visible && tplBtn.inRail, `the rail has no visible Templates button (opnote-day-3.0.1): ${JSON.stringify(tplBtn)}`);
    ok(tplBtn.h >= 40, `the rail Templates button is ${tplBtn.h}px tall (must be ≥ 40)`);
    ok(/templates/i.test(tplBtn.text), `the rail Templates button reads "${tplBtn.text}"`);
    ok(!tplBtn.lit, 'the rail Templates button must never be the glowing next step');
    ok(tplBtn.panelOn || tplBtn.stateAfter === 'templates', `pressing the rail Templates button did not reach the templates panel: ${JSON.stringify(tplBtn)}`);

    /* ================================================================
     * 2. NOTHING IS SELECTED ON OPEN
     * Owner, twice: "always start on all scheduled patients."
     * ============================================================== */
    eq(shape.state, 'list', `the room did not land on the day (state="${shape.state}")`);
    eq(await page.evaluate(() => window.__mlsOpDay.selected()), -1,
      'the room chose a patient for the doctor when it opened');
    eq(shape.editors, 0,
      `${shape.editors} note editors are on screen with nothing selected — the day is a day, and an editor belongs to one patient`);
    eq(listed.filter((r) => r.current).length, 0, 'a rail button is marked current with nothing selected');
    const pick = await page.evaluate(() => {
      const p = document.getElementById('mlsOpnPick');
      return { vis: window.__opn.visible(p), text: p ? (p.textContent || '').replace(/\s+/g, ' ').trim() : '' };
    });
    eq(pick.vis, true, 'with nothing selected the note pane is blank — it must say what to do');
    ok(/pick a patient on the left/i.test(pick.text) && /draft all/i.test(pick.text),
      `the empty note pane does not offer the two ways forward: "${pick.text}"`);
    measured.pick = pick.text;

    /* ================================================================
     * 3. A RAIL BUTTON OPENS THAT PATIENT'S NOTE, EXPANDED, BESIDE IT
     * ============================================================== */
    ok(await page.evaluate(() => window.__opn.pressRow(7)), 'rail button 7 could not be pressed');
    await page.waitForTimeout(900);
    shape = await page.evaluate(() => window.__opn.shape());
    measured.note = shape;
    eq(shape.state, 'note', `pressing a rail button left the room in state "${shape.state}"`);
    eq(shape.railShown, true, 'opening a patient took the rail off screen — that is exactly what 2.0.0 did');
    eq(shape.rows, N_DAY, `opening a patient left ${shape.rows} of ${N_DAY} buttons in the rail`);
    eq(shape.editors, 1,
      `the note pane shows ${shape.editors} editors — exactly one patient's note belongs on it`);
    listed = await page.evaluate(() => window.__opn.listed());
    assert.deepStrictEqual(listed.filter((r) => r.current).map((r) => r.i), [7],
      `the rail marks ${JSON.stringify(listed.filter((r) => r.current).map((r) => r.i))} as current after pressing button 7`);
    checks++;
    const bind = await page.evaluate(() => window.__opn.binding());
    eq(bind.sel, 7, `pressing button 7 selected row ${bind.sel}`);
    eq(bind.name, listed.find((r) => r.i === 7).name,
      `the note pane opened on ${bind.name} after pressing ${listed.find((r) => r.i === 7).name}'s button`);
    eq(bind.patientId, 'syn-7', `the note pane is bound to patient ${bind.patientId}`);
    eq(bind.dateKey, DAY, `the note pane is bound to day ${bind.dateKey}`);
    /* the appointment id, resolved by the app's own stamp from the day's
       schedule-import ledger — the third factor of the binding */
    eq(bind.stamp && bind.stamp.appointmentId, '5550007',
      `the note pane's appointment binding is ${JSON.stringify(bind.stamp)} — a draft must bind to the exact appointment`);
    eq(bind.stamp && bind.stamp.visitDate, DAY, `the visit stamp's day is ${bind.stamp && bind.stamp.visitDate}`);
    const head = await page.evaluate(() => ({
      name: (document.getElementById('mlsOpnName') || {}).textContent || '',
      sub: (document.getElementById('mlsOpnSub') || {}).textContent || '',
      go: (document.getElementById('mlsOpnGo') || {}).textContent || ''
    }));
    eq(head.name, bind.name, `the note pane's heading says "${head.name}"`);
    ok(/\d/.test(head.sub), `the note pane does not show the appointment time or day: "${head.sub}"`);
    ok(/Draft this op note/.test(head.go),
      `an undrafted patient's one action is "${head.go}", not Draft`);

    /* THE GENERATOR IS THE APP'S OWN, CALLED FOR THIS ROW AND NO OTHER. */
    const drafted = await page.evaluate(async () => {
      window.__genSpy = [];
      const base = window.opPrepGenerateOne;
      window.opPrepGenerateOne = function (i) {
        window.__genSpy.push(i);
        const r = (window._opPrep || [])[i];
        if (r) { r.gen = true; r._genPass = true; r.note = 'PROCEDURE: synthetic\nFINDINGS: documented'; }
        try { opPrepRender(); } catch (e) {}
        return Promise.resolve(true);
      };
      document.getElementById('mlsOpnGo').click();
      await new Promise((r) => setTimeout(r, 900));
      window.opPrepGenerateOne = base;
      return { calls: window.__genSpy.slice() };
    });
    assert.deepStrictEqual(drafted.calls, [7],
      `pressing Draft on patient 7's note pane called the drafter for ${JSON.stringify(drafted.calls)} — a note must draft against the row it is showing`);
    checks++;
    await page.waitForTimeout(600);
    const go2 = await page.evaluate(() => (document.getElementById('mlsOpnGo') || {}).textContent || '');
    ok(/Save to/.test(go2), `after a clean draft the one action is "${go2}", not Save`);

    /* THE NOTE COMES EXPANDED, AND THE GREEN BAR IS GONE ------------- */
    let open7 = await page.evaluate(() => ({
      note: window.__opn.seen('#opPrepNote_7'),
      hero: window.__opn.seen('#opPrepPrev_7'),
      name: window.__opn.seen('#mlsOpnName'),
      sub: window.__opn.seen('#mlsOpnSub'),
      go: window.__opn.seen('#mlsOpnGo'),
      copy: window.__opn.seen('#mlsOpnCopy'),
      /* the raw metadata and the template picker are the only things behind a
         line — never the note */
      proc: window.__opn.seen('#opPrepProc_7'),
      tpl: window.__opn.seen('#opPrepTpl_7'),
      det: (document.getElementById('mlsOpnDet') || {}).getAttribute('aria-expanded')
    }));
    eq(open7.note, true,
      'the note text is not on screen when a rail button is pressed — the note must come expanded, with no click first');
    /* THE NAMED CAUSE, so a regression says what broke rather than "not
       visible". msl-1.0.0 marks every op-note card data-msl-card="shut" except
       the one index it remembers, and its own rule then hides every child of a
       shut card except the green hero. */
    eq(await page.evaluate(() => {
      const c = document.querySelector('#opPrepList > div.opr-cur');
      return c ? c.getAttribute('data-msl-card') : 'no current card';
    }), 'open',
      'the card the note pane is showing is not marked open, so msl-1.0.0 collapses it to the green bar and hides the note');
    eq(open7.hero, false, 'the dark-green PROCEDURE bar is still on the note pane');
    eq(open7.name, true, 'the note pane shows no patient name');
    eq(open7.sub, true, 'the note pane shows no procedure/day line');
    eq(open7.go, true, 'the note pane shows no action');
    eq(open7.copy, true, 'the note pane offers no way to copy the note');
    eq(open7.proc, false, 'the raw procedure field is open before anyone asked for it');
    eq(open7.tpl, false, 'the template picker is open before anyone asked for it');
    eq(open7.det, 'false', 'the details disclosure does not report itself shut');

    /* NO BIG COLOURED PANEL ANYWHERE ON THIS SURFACE. Measured, not asserted
       by class name: any visible node in the note pane (or in the one card it
       shows) taller than 56px that paints a gradient is the bar coming back
       under another name. */
    const slabs = await page.evaluate(() => {
      const out = [];
      const roots = [document.getElementById('mlsOpnNote'),
        document.querySelector('#opPrepList > div.opr-cur')].filter(Boolean);
      roots.forEach((root) => {
        Array.from(root.querySelectorAll('*')).concat([root]).forEach((e) => {
          if (!window.__opn.visible(e)) return;
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          const painted = (cs.backgroundImage && cs.backgroundImage !== 'none');
          if (!painted || r.height <= 56) return;
          out.push({ id: e.id || String(e.className || '').slice(0, 30) || e.tagName,
            h: Math.round(r.height), bg: cs.backgroundImage.slice(0, 60) });
        });
      });
      return out;
    });
    assert.deepStrictEqual(slabs, [],
      `the note pane still paints a full-height coloured slab: ${JSON.stringify(slabs)} — the owner asked for a small plain header, not a bar`);
    checks++;
    const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#mlsOpnChips .mlsOpnChip')).map((c) => c.textContent));
    ok(chips.length > 0,
      'the side/level chips the green bar used to carry are nowhere on the note pane — that information was deleted, not moved');
    measured.chips = chips;

    /* COPY: the button copies the note the doctor is looking at, and it copies
       the TEXTAREA — the same node opPrepSave() reads — so nothing can go
       stale between the copy and the chart. */
    const copied = await page.evaluate(() => {
      const ta = document.getElementById('opPrepNote_7');
      let asked = '';
      const base = document.execCommand;
      document.execCommand = function (cmd) { if (cmd === 'copy') asked = String(document.getSelection()); return true; };
      const did = window.__mlsOpDay.copy();
      document.execCommand = base;
      return { did, asked: asked.slice(0, 40), note: (ta ? ta.value : '').slice(0, 40) };
    });
    eq(copied.did, true, 'the Copy control did not copy anything');
    ok(copied.note.length > 0, 'the note is empty, so the copy check proved nothing');

    /* ================================================================
     * 4. THE FORMATTED VIEW STARTS HIDDEN, EVERY OPEN
     *
     * feat_mls_fixpack_0701 attaches .mls-fp-fmt to a note textarea only when
     * the note is over 200 characters AND looks structured, and only when one
     * of ITS OWN refresh reasons fires. So the wrapper is NUDGED into
     * existence here the way a doctor does it — an input event on the note he
     * is typing in — rather than waited for blindly; if it never appears the
     * suite says so rather than passing vacuously.
     * ============================================================== */
    const LONG_NOTE = ['PROCEDURE PERFORMED:', 'Lumbar medial branch block', '',
      'INDICATIONS:', 'Chronic low back pain refractory to six months of conservative care.', '',
      'TECHNIQUE:', '- The area was prepped and draped in the usual sterile fashion.',
      '- Fluoroscopic guidance was used throughout the procedure.',
      '- The needle was advanced under direct visualization.', '',
      'FINDINGS:', 'Documented in full.', '', 'DISPOSITION:', 'Stable, discharged to recovery.'].join('\n');
    await page.evaluate(async (body) => {
      const rows = window._opPrep || [];
      rows.forEach((r) => { r.gen = true; r.note = body; });
      opPrepRender();
      await new Promise((r) => setTimeout(r, 1500));
      window.__mlsOpDay.back();
    }, LONG_NOTE);
    const readFmt = () => page.evaluate(() => {
      const list = document.getElementById('opPrepList');
      const kids = list ? Array.from(list.children) : [];
      const cur = document.querySelector('#opPrepList > div.opr-cur');
      return {
        st: window.__mlsOpDay.status().formatted,
        withWrap: kids.map((c, i) => (c.querySelector('.mls-fp-fmt') ? i : -1)).filter((i) => i >= 0),
        onCurrent: !!(cur && cur.querySelector('.mls-fp-fmt')),
        bodies: Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt .fmt-body')).filter(window.__opn.visible).length,
        control: window.__opn.seen('#mlsOpnFmt'),
        expanded: (document.getElementById('mlsOpnFmt') || {}).getAttribute('aria-expanded')
      };
    });
    /* SETTLE ON BOTH FACTS, not just the first. The fixpack attaches the
       wrappers on its own cadence and the room takes them in hand on its next
       (coalesced) paint — sampling the instant a wrapper EXISTS reads it
       before that paint and scores every one of them as unmarked. */
    let fmt = await readFmt();
    for (let i = 0; i < 16 && (fmt.withWrap.length === 0 || fmt.st.unmarked > 0); i++) {
      await page.waitForTimeout(700);
      await page.evaluate(() => { try { window.__mlsOpDay.refresh(); } catch (e) {} });
      await page.waitForTimeout(300);
      fmt = await readFmt();
    }
    ok(fmt.withWrap.length > 0,
      `no formatted view attached to any note, so this section proved nothing: ${JSON.stringify(fmt)}`);
    /* THE OWNER'S RULING, over every formatted view in the room at once: each
       one is taken in hand, each one is SHUT, and not one body is on screen. */
    eq(fmt.st.unmarked, 0, `${fmt.st.unmarked} formatted views were never taken in hand`);
    eq(fmt.st.open, 0, `${fmt.st.open} formatted views are marked open before anyone asked for one`);
    eq(fmt.bodies, 0,
      `${fmt.bodies} formatted-view bodies are on screen before anyone asked for one — it must start hidden every open`);

    /* ... and the pane's own control opens it. Driven on a patient that
       ACTUALLY HAS a formatted view: the fixpack attaches one on its own
       cadence and does not always have one on the card that happens to be
       open, so picking a card with one is the difference between proving the
       control works and proving nothing. */
    const withWrap = fmt.withWrap[0];
    await page.evaluate((i) => window.__opn.pressRow(i), withWrap);
    await page.waitForTimeout(1200);
    fmt = await readFmt();
    measured.fmt = Object.assign({ pickedRow: withWrap }, fmt);
    if (fmt.onCurrent) {
      eq(fmt.control, true, 'the open note has a formatted view but no control to open it — that is a deletion, not a fold');
      eq(fmt.expanded, 'false', 'the formatted-view control does not report itself shut on open');
      eq(fmt.bodies, 0, 'the open note showed its formatted view before anyone asked for one');
      const fmtOpen = await page.evaluate(async () => {
        document.getElementById('mlsOpnFmt').click();
        await new Promise((r) => setTimeout(r, 800));
        return { bodies: Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt .fmt-body')).filter(window.__opn.visible).length,
          expanded: (document.getElementById('mlsOpnFmt') || {}).getAttribute('aria-expanded') };
      });
      eq(fmtOpen.bodies, 1, `pressing the formatted-view control showed ${fmtOpen.bodies} bodies — a fold that cannot open is a deletion`);
      eq(fmtOpen.expanded, 'true', 'the formatted-view control did not report itself open');
      /* re-opening the SAME patient starts shut again, remembering nothing */
      await page.evaluate(async () => { window.__mlsOpDay.back(); await new Promise((r) => setTimeout(r, 400)); });
      await page.waitForTimeout(600);
      await page.evaluate((i) => window.__opn.pressRow(i), withWrap);
      await page.waitForTimeout(1100);
      const again = await readFmt();
      eq(again.bodies, 0, 're-opening the patient remembered that the formatted view was open');
    } else {
      /* MEASURED AND RECORDED RATHER THAN ASSUMED AWAY. feat_mls_fixpack_0701
         attaches .mls-fp-fmt to a note textarea on its own refresh reasons,
         and feat_mls_opnote_fill hands back a brand-new textarea for the card
         it is managing — so the OPEN card can legitimately be between
         attachments. The contract above (every wrapper shut, no body on
         screen) still holds over the whole room; the pane's control is hidden
         exactly when there is nothing for it to open, which is the honest
         behaviour and is asserted here. */
      eq(fmt.control, false,
        'the note pane shows a Formatted-view control while the open note has no formatted view to show');
      measured.fmtNote = 'the open card had no .mls-fp-fmt attached at sample time; contract proven across the room instead';
    }
    /* the note itself is still on screen either way */
    eq(await page.evaluate(() => window.__opn.seen('#opPrepList > div.opr-cur textarea[id^="opPrepNote_"]')), true,
      'the note text is not on screen after re-opening the patient');
    await page.evaluate(() => window.__opn.pressRow(7));
    await page.waitForTimeout(900);

    /* the two disclosures still hold the raw metadata, and they open */
    await page.evaluate(() => window.__opn.press('mlsOpnDet'));
    await page.waitForTimeout(500);
    eq(await page.evaluate(() => window.__opn.seen('#opPrepProc_7')), true,
      'clicking the details disclosure did not reveal the procedure field — a fold that cannot open is a deletion');
    await page.evaluate(() => window.__opn.press('mlsOpnTplBtn'));
    await page.waitForTimeout(500);
    const tplOpen = await page.evaluate(() => ({
      sel: window.__opn.seen('#opPrepTpl_7'), lib: window.__opn.seen('#mlsOpnTplLib')
    }));
    eq(tplOpen.sel, true, 'the Template disclosure did not reveal the template picker');
    eq(tplOpen.lib, true, 'the Template disclosure carries no way into the template library');

    /* ================================================================
     * 5. THE DAY SWITCHES EASILY, AND THE RAIL RE-LISTS
     * ============================================================== */
    ok(await page.evaluate(() => window.__opn.press('mlsOpnNextDay')), 'the next-day arrow is missing');
    await page.waitForTimeout(1400);
    let day = await page.evaluate(() => window.__mlsOpDay.day());
    eq(day, DAY_NEXT, 'the next-day arrow did not move the day');
    listed = await page.evaluate(() => window.__opn.listed());
    eq(listed.length, 3, `the 3-patient day lists ${listed.length} buttons`);
    eq(await page.evaluate(() => window.__mlsOpDay.selected()), -1,
      'switching the day kept a patient selected — that selection points at a different patient now');
    ok(await page.evaluate(() => window.__opn.press('mlsOpnPrevDay')), 'the previous-day arrow is missing');
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => window.__opn.press('mlsOpnPrevDay')), 'the previous-day arrow vanished');
    await page.waitForTimeout(1400);
    day = await page.evaluate(() => window.__mlsOpDay.day());
    eq(day, DAY_PREV, 'two presses of the previous-day arrow did not land on the empty day');

    /* an empty day is never a blank room, and the RAIL is still there */
    shape = await page.evaluate(() => window.__opn.shape());
    measured.empty = shape;
    eq(shape.state, 'empty', `a day with no appointments is in state "${shape.state}"`);
    eq(shape.railShown, true, 'an empty day took the rail off screen');
    const emptyText = await page.evaluate(() => {
      const e = document.getElementById('mlsOpnEmpty');
      return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : '';
    });
    ok(/No scheduled patients on/i.test(emptyText) && /August/i.test(emptyText),
      `the empty day does not name the day it is empty on: "${emptyText}"`);
    /* and its one action is the app's OWN day pull */
    const pull = await page.evaluate(async () => {
      window.__pullSpy = [];
      const ds = window.__mlsDaySwitch;
      if (!ds) return { why: 'no day switch' };
      const setDay = ds.setDay, pullDay = ds.pullDay;
      ds.setDay = function (k) { window.__pullSpy.push(['setDay', k]); };
      ds.pullDay = function () { window.__pullSpy.push(['pullDay']); };
      document.getElementById('mlsOpnPull').click();
      await new Promise((r) => setTimeout(r, 700));
      ds.setDay = setDay; ds.pullDay = pullDay;
      return { calls: window.__pullSpy };
    });
    assert.deepStrictEqual(pull.calls, [['setDay', DAY_PREV], ['pullDay']],
      `the empty day's pull button did not drive the app's own day pull for ${DAY_PREV}: ${JSON.stringify(pull)}`);
    checks++;

    /* back to the full day, this time through the date picker */
    await page.evaluate((d) => { const i = document.getElementById('mlsOpnDayIn'); if (i) { i.value = d; i.dispatchEvent(new Event('change', { bubbles: true })); } }, DAY);
    await page.waitForTimeout(1600);
    eq(await page.evaluate(() => window.__mlsOpDay.day()), DAY, 'the date picker did not move the day');
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(1600);
    listed = await page.evaluate(() => window.__opn.listed());
    eq(listed.length, N_DAY, `back on the ${N_DAY}-patient day the rail lists ${listed.length} buttons`);

    /* the left/right keys move the day when nothing is selected */
    await page.evaluate(() => { try { document.activeElement.blur(); } catch (e) {} document.body.focus(); });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1400);
    eq(await page.evaluate(() => window.__mlsOpDay.day()), DAY_NEXT,
      'the right-arrow key did not move the day forward from the rail');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1400);
    eq(await page.evaluate(() => window.__mlsOpDay.day()), DAY, 'the left-arrow key did not move the day back');

    /* the Today button appears only when the day is not today */
    const todayBtn = await page.evaluate(() => {
      const t = document.getElementById('mlsOpnToday');
      return { onOtherDay: !!(t && !t.hidden) };
    });
    eq(todayBtn.onOtherDay, true, 'there is no way back to today from another day');

    /* the search box filters the rail */
    await page.evaluate(() => { const s = document.getElementById('mlsOpnSearch'); s.value = 'Ivy'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(600);
    listed = await page.evaluate(() => window.__opn.listed());
    eq(listed.length, 1, `searching for one patient left ${listed.length} buttons in the rail`);
    eq(listed[0].name, 'Ivy Sample', `the search matched ${listed[0].name}`);
    await page.evaluate(() => { const s = document.getElementById('mlsOpnSearch'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(600);

    /* ================================================================
     * 6. STATUS IS DERIVED FROM WHAT IS STORED
     * ============================================================== */
    await page.evaluate(() => {
      const rows = window._opPrep || [];
      const led = document.getElementById('tpfLedgerList'); if (led) led.innerHTML = '';
      rows.forEach((r) => { delete r._genErr; delete r._lastDraftErr; delete r._noteId; r.gen = false; r.note = ''; });
      rows[1].gen = true; rows[1].note = 'PROCEDURE: done\nFINDINGS: documented';
      rows[2].gen = true; rows[2].note = 'PROCEDURE: done\nFINDINGS: [[findings]]';
      rows[3]._genErr = 'the note service was busy';
      /* row 4 is DRAFTED AND FILED: a real, finalized record in the chart */
      rows[4].gen = true; rows[4].note = 'PROCEDURE: done\nFINDINGS: documented';
      const ns = (typeof getNotes === 'function' ? getNotes() : []) || [];
      const id = 'n-filed-4';
      rows[4]._noteId = id;
      ns.unshift({ id: id, patient: rows[4].appt.name, patientId: rows[4].patientId,
        cc: 'filed', text: rows[4].note, kind: 'opnote', isDraft: false, created: Date.now(), updated: Date.now() });
      saveNotes(ns);
      opPrepRender();
      window.__mlsOpDay.refresh();
    });
    await page.waitForTimeout(900);
    listed = await page.evaluate(() => window.__opn.listed());
    const byIdx = {};
    listed.forEach((r) => { byIdx[r.i] = r; });
    eq(byIdx[0].state, 'queued', `an untouched patient reads "${byIdx[0].state}" (${byIdx[0].chip})`);
    eq(byIdx[1].state, 'ready', `a finished draft reads "${byIdx[1].state}" (${byIdx[1].chip})`);
    eq(byIdx[2].state, 'review', `a draft with blanks reads "${byIdx[2].state}" (${byIdx[2].chip})`);
    ok(/blank/i.test(byIdx[2].why), `a patient needing review does not say what is missing: "${byIdx[2].why}"`);
    eq(byIdx[3].state, 'failed', `a failed draft reads "${byIdx[3].state}" (${byIdx[3].chip})`);
    ok(byIdx[3].why.trim().length > 3, `a failed patient carries no reason: "${byIdx[3].why}"`);
    eq(byIdx[4].state, 'filed',
      `a note that is finalized in the chart reads "${byIdx[4].state}" (${byIdx[4].chip}) — status must follow what is stored`);

    /* ================================================================
     * 7. EXACTLY ONE GLOWING CONTROL, AND IT IS THE RIGHT ONE
     *
     * Owner, 2026-08-18: "the glowing boxes animation looks good but it always
     * highlights the wrong box — why would it highlight templates."
     *
     * Driven through the real state machine on the real fixture. Every reading
     * is nextglow-1.0.0's own report(), so this cannot pass by agreeing with
     * the block that publishes the id.
     * ============================================================== */
    const glowTable = [];
    /* THE HALO MUST ACTUALLY BE ON SCREEN. nextglow draws it as
       [data-mls-next="1"]::after — and a REPLACED element (<input>, <select>)
       generates no ::after box at all, so "the glow is on the empty NPI field"
       can be true and invisible at the same time. MEASURED on the real page
       before this check existed: a note surface with the glow resolved and
       ZERO running animations in the room. Every state below asserts a halo
       that renders AND is running. */
    async function haloOf(page2) {
      return page2.evaluate(() => {
        const e = document.querySelector('[data-mls-next="1"]');
        if (!e) return null;
        const cs = getComputedStyle(e, '::after');
        const running = (document.getAnimations ? document.getAnimations() : [])
          .filter((a) => a.playState === 'running' && a.effect && a.effect.target === e).length;
        return { tag: e.tagName, id: e.id || '', content: cs.content, anim: cs.animationName, running };
      });
    }
    async function glowIs(want, where) {
      const g = await settleGlow(page);
      const halo = await haloOf(page);
      glowTable.push({ where, want, got: g.id, count: g.count, said: g.want, state: g.state,
        halo: halo && (halo.tag + ' anim=' + halo.anim + ' running=' + halo.running) });
      eq(g.count, 1, `${where}: ${g.count} controls are glowing, not 1 (${JSON.stringify(g.lit)})`);
      eq(g.id, want, `${where}: the glow is on "${g.id}", not "${want}" (the room asked for "${g.said}", state "${g.state}")`);
      eq(g.room, 'opnotes', `${where}: the glow believes it is in room "${g.room}"`);
      ok(halo, `${where}: nothing carries the next-step marker at all`);
      ok(halo.content !== 'none',
        `${where}: the glow is on a <${halo.tag}>, which generates no ::after — the halo is invisible: ${JSON.stringify(halo)}`);
      eq(halo.anim, 'mlsNgPulse', `${where}: the glowing control has no halo animation: ${JSON.stringify(halo)}`);
      ok(halo.running >= 1, `${where}: the halo is not running: ${JSON.stringify(halo)}`);
      return g;
    }
    /* a) nothing selected, the day still needs notes -> Draft all N */
    await page.evaluate(() => window.__mlsOpDay.back());
    await page.waitForTimeout(900);
    await glowIs('opPrepGenAllBtn', 'nothing selected, notes still to draft');
    /* b) a patient with no note -> that patient's Draft */
    await page.evaluate(() => window.__opn.pressRow(0));
    await page.waitForTimeout(900);
    await glowIs('mlsOpnGo', 'patient selected, no note yet');
    eq(await page.evaluate(() => (document.getElementById('mlsOpnGo') || {}).textContent || ''),
      '✨ Draft this op note', 'the glowing control on an undrafted patient is not the Draft action');
    /* c) drafted and unsaved -> Save to chart */
    await page.evaluate(async () => {
      const r = (window._opPrep || [])[0];
      r.gen = true; r._genPass = true; r.note = 'PROCEDURE: Lumbar medial branch block\nFINDINGS: documented';
      opPrepRender();
      await new Promise((x) => setTimeout(x, 400));
      window.__mlsOpDay.refresh();
    });
    await page.waitForTimeout(900);
    await glowIs('mlsOpnGo', 'note drafted, not yet in the chart');
    ok(/Save to/.test(await page.evaluate(() => (document.getElementById('mlsOpnGo') || {}).textContent || '')),
      'the glowing control on a finished draft is not Save');
    /* d) saved -> the BIG "Open in History", through the app's OWN save */
    const saved = await page.evaluate(async () => {
      document.getElementById('mlsOpnGo').click();
      await new Promise((x) => setTimeout(x, 1200));
      const row = (window._opPrep || [])[0];
      const rec = ((typeof getNotes === 'function' ? getNotes() : []) || []).filter((n) => n.id === row._noteId)[0] || null;
      const h = document.getElementById('mlsOpnHist');
      return { noteId: String(row._noteId || ''), isDraft: rec ? !!rec.isDraft : null,
        histShown: window.__opn.visible(h),
        histRect: window.__opn.rect(h),
        goRect: window.__opn.rect(document.getElementById('mlsOpnGo')) };
    });
    ok(saved.noteId, `the app's own Save did not write a record: ${JSON.stringify(saved)}`);
    eq(saved.isDraft, false, `the saved record is still a draft: ${JSON.stringify(saved)}`);
    eq(saved.histShown, true, 'after a save there is no "Open in History" control');
    /* BIG. Owner: "big and flashing". The flashing is the glow; the big is
       measured here against the room's own other pill controls. */
    ok(saved.histRect.h >= 44,
      `the "Open in History" control is ${saved.histRect.h}px tall — the owner asked for a big one`);
    measured.hist = saved.histRect;
    await glowIs('mlsOpnHist', 'note saved to the chart');
    /* and it goes where it says: the app's own anchor, clicked */
    const wentToHistory = await page.evaluate(async () => {
      const seen = [];
      const bView = window.showView, bAct = window.setActivePtId;
      window.showView = function (v) { seen.push(['showView', v]); };
      window.setActivePtId = function (p) { seen.push(['setActivePtId', p]); };
      window.__mlsOpDay.openInHistory();
      await new Promise((x) => setTimeout(x, 400));
      window.showView = bView; window.setActivePtId = bAct;
      return seen;
    });
    ok(wentToHistory.some((c) => c[0] === 'showView' && c[1] === 'history'),
      `"Open in History" did not take the doctor to History: ${JSON.stringify(wentToHistory)}`);
    ok(wentToHistory.some((c) => c[0] === 'setActivePtId' && c[1] === 'syn-0'),
      `"Open in History" did not make the note's own patient active: ${JSON.stringify(wentToHistory)}`);
    measured.glow = glowTable;

    /* ================================================================
     * 8. ONE TEMPLATES HOP, AND NO LIBRARY IN THE ROOM
     * ============================================================== */
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(1800);
    const tpl = await page.evaluate(() => {
      const outside = Array.from(document.querySelectorAll('button[onclick="openTemplates()"]'))
        .filter((b) => !b.closest('#opPrepModal'));
      /* opnote-day-3.0.1: the rail's ONE Templates hop (#mlsOpnRailTpl) is
         allowed on the day — the owner asked for it by name ("there is no
         Templates button"). It calls the shell's openTemplates(); it is not a
         library and not a second picker, and it is asserted separately above. */
      const inside = Array.from(document.querySelectorAll('#opPrepModal button'))
        .filter(window.__opn.visible)
        .filter((b) => b.id !== 'mlsOpnRailTpl')
        .filter((b) => /template/i.test(b.textContent || ''));
      return {
        outside: outside.length,
        said: outside.filter((b) => /op-note templates/i.test(b.textContent || '') && /in Op Notes/i.test(b.textContent || '')).length,
        labels: outside.map((b) => (b.textContent || '').trim().slice(0, 50)),
        insideVisible: inside.map((b) => b.id || (b.textContent || '').trim().slice(0, 26)),
        railLibrary: window.__opn.seen('#oprTplRail')
      };
    });
    ok(tpl.outside > 0, 'there are no Templates buttons outside the room, so this check proved nothing');
    eq(tpl.said, tpl.outside,
      `${tpl.outside - tpl.said} Templates buttons outside the room still do not say they are op-note templates living in Op Notes: ${JSON.stringify(tpl.labels)}`);
    eq(tpl.railLibrary, false,
      'the room still renders its own template library in the rail — the rail is patients, and templates have one home');
    eq(tpl.insideVisible.length, 0,
      `the day shows ${tpl.insideVisible.length} template controls with nothing selected: ${JSON.stringify(tpl.insideVisible)}`);

    /* THE ROUND TRIP, because a library you cannot leave is a dead end. */
    const trip = await page.evaluate(async () => {
      const vis = (s) => window.__opn.seen(s);
      window.__mlsOpDay.openNote(0);
      await new Promise((r) => setTimeout(r, 800));
      window.__mlsOpDay.setTemplate(true);
      await new Promise((r) => setTimeout(r, 400));
      const hops = Array.from(document.querySelectorAll('#opPrepModal button'))
        .filter(window.__opn.visible)
        .filter((b) => /template library|openTemplates/i.test((b.textContent || '') + (b.getAttribute('onclick') || '')));
      const onNote = { state: window.__mlsOpDay.state(), lib: vis('#mlsOpnTplLib'), top: vis('.opr-top'),
        hops: hops.map((b) => b.id || (b.textContent || '').trim().slice(0, 26)) };
      document.getElementById('mlsOpnTplLib').click();
      await new Promise((r) => setTimeout(r, 1600));
      const inLib = { state: window.__mlsOpDay.state(), list: vis('#tplList'), top: vis('.opr-top'),
        home: vis('#oprTabProcs'), rail: vis('#oprDayRail'),
        roomOpen: !!document.getElementById('opPrepModal').classList.contains('show') };
      const home = document.getElementById('oprTabProcs');
      if (home) home.click();
      await new Promise((r) => setTimeout(r, 1600));
      const back = { state: window.__mlsOpDay.state(), surface: vis('#mlsOpnNote'), rail: vis('#oprDayRail'),
        roomOpen: !!document.getElementById('opPrepModal').classList.contains('show') };
      return { onNote, inLib, back };
    });
    eq(trip.onNote.lib, true, 'the note pane offers no way into the template library');
    eq(trip.onNote.hops.length, 1,
      `the note pane offers ${trip.onNote.hops.length} ways into the template library: ${JSON.stringify(trip.onNote.hops)} — there must be exactly one`);
    eq(trip.onNote.top, false, "the room's old top bar is back on the note pane");
    eq(trip.inLib.state, 'templates', `pressing the library left the room in state "${trip.inLib.state}"`);
    eq(trip.inLib.list, true, 'the template library did not land on anything visible — that is a dead end');
    eq(trip.inLib.top, true,
      'the template library has no visible way back to the procedures — the doctor is stuck in the library');
    eq(trip.inLib.rail, false, 'the patient rail is still on screen inside the template library');
    eq(trip.back.state, 'note', `coming back from the library left the room in state "${trip.back.state}"`);
    eq(trip.back.surface, true, 'coming back from the library did not restore the note pane');
    eq(trip.back.rail, true, 'coming back from the library did not restore the rail');
    eq(trip.back.roomOpen, true, 'coming back from the library closed the room');

    /* ================================================================
     * 9. "ALWAYS START ON ALL SCHEDULED PATIENTS", ON A RE-OPEN
     * ============================================================== */
    {
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__opn.pressRow(5));
      await page.waitForTimeout(900);
      eq(await page.evaluate(() => window.__mlsOpDay.state()), 'note',
        'the room did not open a note pane, so this section proved nothing');
      /* a repaint must NOT throw him off the note */
      await page.evaluate(() => { try { opPrepRender(); } catch (e) {} });
      await page.waitForTimeout(700);
      eq(await page.evaluate(() => window.__mlsOpDay.state()), 'note',
        'a repaint of the room threw the doctor off the note he was working on');
      eq(await page.evaluate(() => window.__mlsOpDay.selected()), 5,
        'a repaint of the room moved the selected patient');
      /* ... and a real re-open, on the SAME day, must land on the whole day */
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1600);
      eq(await page.evaluate(() => window.__mlsOpDay.state()), 'list',
        'pressing Prep op notes again came back to one patient\'s note instead of the day\'s patients');
      eq(await page.evaluate(() => window.__mlsOpDay.selected()), -1,
        're-opening the room kept a patient selected');
    }

    /* ================================================================
     * 10. THE KEYBOARD
     * ============================================================== */
    {
      await page.evaluate(() => window.__opn.pressRow(7));
      await page.waitForTimeout(800);
      await page.evaluate(() => { try { document.activeElement.blur(); } catch (e) {} document.body.focus(); });
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
      eq(await page.evaluate(() => window.__mlsOpDay.selected()), 8,
        'the right-arrow key did not move to the next patient on the note pane');
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(700);
      eq(await page.evaluate(() => window.__mlsOpDay.selected()), 7,
        'the left-arrow key did not move back to the previous patient');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const afterEsc = await page.evaluate(() => ({
        open: !!document.getElementById('opPrepModal').classList.contains('show'),
        state: String(document.getElementById('opPrepModal').getAttribute('data-mls-opnotes-state') || ''),
        rail: window.__opn.seen('#oprDayRail')
      }));
      eq(afterEsc.open, true,
        'Escape on a note pane threw the whole room away instead of going back to the day');
      eq(afterEsc.state, 'list', `Escape on a note pane left the room in state "${afterEsc.state}"`);
      eq(afterEsc.rail, true, 'Escape took the rail off screen');
      /* and a second Escape leaves the room, as it always has */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      eq(await page.evaluate(() => !!document.getElementById('opPrepModal').classList.contains('show')), false,
        'Escape from the day no longer closes the room');
    }

    /* ================================================================
     * 11. THE ROOM OPENS AT ITS OWN TOP, AND NOTHING IS COVERED
     * ============================================================== */
    {
      const place = async (label) => page.evaluate((tag) => {
        const modal = document.getElementById('opPrepModal');
        const inner = modal && modal.querySelector('.modal');
        const head = document.getElementById('mlsOpDay');
        const scrollers = [modal, inner, document.getElementById('oprEditor'),
          document.getElementById('oprDayRail'), document.getElementById('oprPanelProcs')]
          .filter(Boolean).map((n) => Math.round(n.scrollTop));
        return { tag: tag,
          headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
          modalTop: modal ? Math.round(modal.getBoundingClientRect().top) : null,
          scrollers: scrollers, occluded: window.__opn.occluded() };
      }, label);

      const scrollDown = () => page.evaluate(() => {
        const modal = document.getElementById('opPrepModal');
        const inner = modal.querySelector('.modal');
        [modal, inner, document.getElementById('oprEditor'), document.getElementById('oprDayRail'),
          document.getElementById('oprPanelProcs')].filter(Boolean).forEach((n) => { n.scrollTop = 900; });
      });

      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1800);
      const onOpen = await place('open');
      await scrollDown();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__opn.pressRow(12));
      await page.waitForTimeout(1100);
      const onNote = await place('note');
      await scrollDown();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__mlsOpDay.back());
      await page.waitForTimeout(1000);
      const onBack = await place('back');
      measured.place = [onOpen, onNote, onBack];

      for (const p of [onOpen, onNote, onBack]) {
        ok(p.headTop >= 0,
          `after "${p.tag}" the rail's day switcher sits at ${p.headTop}px — above the top of the window, i.e. under the browser chrome`);
        ok(p.headTop >= p.modalTop,
          `after "${p.tag}" the rail's day switcher (${p.headTop}px) is above the room's own box (${p.modalTop}px)`);
        assert.deepStrictEqual(p.scrollers.filter((s) => s !== 0), [],
          `after "${p.tag}" the room is still scrolled (${JSON.stringify(p.scrollers)}) — every surface is the first thing in its column, so the room must open at its own top`);
        checks++;
        assert.deepStrictEqual(p.occluded, [],
          `after "${p.tag}" these room controls are painted over by something else: ${JSON.stringify(p.occluded)}`);
        checks++;
      }
    }

    /* ================================================================
     * 12. THE TASKBAR NEVER COVERS THE PATIENTS
     * ============================================================== */
    {
      const dockUp = await page.waitForFunction(() => !!document.getElementById('mlsDock'), null, { timeout: 30000 })
        .then(() => true).catch(() => false);
      /* THE SIDE IS CHOSEN, NOT ASSUMED. The taskbar remembers a per-doctor
         side, so measuring "wherever it happens to be" would score a left rail
         as proof about the bottom one. */
      if (dockUp) {
        await page.evaluate(() => { try { window.__mlsDock1p.side('bottom'); } catch (e) {} });
        await page.waitForTimeout(700);
      }
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1800);
      const fit = await page.evaluate(() => ({
        fit: window.__mlsOpDay.fit(),
        listBottom: (() => { const e = document.getElementById('mlsOpDayList'); return e ? Math.round(e.getBoundingClientRect().bottom) : null; })(),
        scrolls: (() => { const e = document.getElementById('mlsOpDayList'); return !!(e && e.scrollHeight > e.clientHeight + 2); })(),
        innerH: window.innerHeight,
        dock: (() => {
          const d = document.getElementById('mlsDock');
          if (!d) return null;
          const r = d.getBoundingClientRect();
          return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
        })()
      }));
      measured.fit = Object.assign({ dockUp }, fit);
      ok(fit.fit.capped > 0,
        `the patient list is not capped at all (${JSON.stringify(fit.fit)}) — with ${N_DAY} patients it runs past the window and under the taskbar`);
      if (dockUp && fit.dock && fit.dock.top > fit.innerH / 2) {
        ok(fit.listBottom <= fit.dock.top,
          `the patient list ends at ${fit.listBottom}px and the taskbar starts at ${fit.dock.top}px — the taskbar covers the patients`);
        const hits = await page.evaluate(() => window.__mlsDock1p.roomObstruction());
        ok(hits && hits.n > 0, `the taskbar obstruction probe sampled nothing: ${JSON.stringify(hits)}`);
        eq(hits.hits, 0,
          `the taskbar covers the op-note room's content at ${hits.hits}/${hits.n} sample points`);
      } else {
        ok(fit.fit.band >= 100,
          `with no taskbar rendered the list reserved ${fit.fit.band}px — the shell's own --opr-dock-clear is at least 104px`);
      }
      /* the day strip stays put while the patients scroll under it */
      const stayed = await page.evaluate(async () => {
        const before = Math.round(document.getElementById('mlsOpDay').getBoundingClientRect().top);
        const list = document.getElementById('mlsOpDayList');
        list.scrollTop = list.scrollHeight;
        await new Promise((r) => setTimeout(r, 300));
        return { before, after: Math.round(document.getElementById('mlsOpDay').getBoundingClientRect().top),
          scrolled: Math.round(list.scrollTop) };
      });
      ok(stayed.scrolled > 0, `the patient list did not scroll: ${JSON.stringify(stayed)}`);
      eq(stayed.after, stayed.before,
        `scrolling the patients moved the day switcher (${stayed.before}px -> ${stayed.after}px) — the switcher must stay put`);
      await page.evaluate(() => { const l = document.getElementById('mlsOpDayList'); if (l) l.scrollTop = 0; });
    }

    /* ================================================================
     * 13. AUTOMATIC DRAFTING SPEAKS ON THIS SCREEN, NOT IN A TOAST
     * ============================================================== */
    {
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1500);
      const said = await page.evaluate(async () => {
        window.__toasts = [];
        if (!window.__toastSpied) {
          window.__toastSpied = 1;
          const base = window.toast;
          window.toast = function (msg) { window.__toasts.push(String(msg).slice(0, 60)); return base.apply(this, arguments); };
        }
        /* re-arm autodraft and let it start a run the way the room opening
           does — this is msl-autodraft's own path, not a stub */
        try { window.__mlsAutoDraft.revert(); } catch (e) {}
        try { window.__mlsAutoDraft.setEnabled(true); } catch (e) {}
        window.__genCalls = 0;
        const base1 = window.opPrepGenerateOne;
        window.opPrepGenerateOne = function (i) {
          window.__genCalls++;
          const r = (window._opPrep || [])[i];
          if (r) { r.gen = true; r._genPass = true; r.note = 'PROCEDURE: synthetic\nFINDINGS: documented'; }
          return Promise.resolve(true);
        };
        document.getElementById('opPrepModal').classList.remove('show');
        await new Promise((r) => setTimeout(r, 300));
        window.openOpPrep('2026-08-17');
        /* SAMPLE IT WHILE IT IS TRUE. The quiet line is deliberately
           self-clearing — once the day has nothing left to draft the sentence
           is no longer true, and with a stubbed drafter the whole day finishes
           in well under a second. */
        const seen = [];
        for (let k = 0; k < 60; k++) {
          await new Promise((r) => setTimeout(r, 60));
          const n = window.__mlsOpDay.notice();
          if (n) seen.push(n);
        }
        const out = {
          notice: seen[0] || '', samples: seen.length, after: window.__mlsOpDay.notice(),
          toasts: window.__toasts.slice(), status: window.__mlsAutoDraft.status(), gen: window.__genCalls
        };
        window.opPrepGenerateOne = base1;
        try { window.__mlsAutoDraft.setEnabled(false); } catch (e) {}
        return out;
      });
      ok(said.gen > 0 || said.status.ranThisSession,
        `automatic drafting never started, so this section proved nothing: ${JSON.stringify(said)}`);
      ok(/Drafting the op notes/.test(said.notice),
        `the automatic run said nothing on the screen it is about — the room's quiet status read "${said.notice}" across ${said.samples} samples`);
      eq(said.after, '',
        `the quiet status is still saying "${said.after}" after the day has nothing left to draft — a status that outlives its fact is the toast problem again`);
      assert.deepStrictEqual(said.toasts.filter((t) => /Drafting the op notes/.test(t)), [],
        `the automatic run raised a floating toast as well as the inline status: ${JSON.stringify(said.toasts)}`);
      checks++;
      measured.notice = said.notice;
      eq(await page.evaluate(() => {
        const n = document.getElementById('mlsOpnNotice');
        return n ? n.tagName : 'absent';
      }), 'P', 'the quiet run status is a control rather than a line of text');
    }

    /* ================================================================
     * 14. THE SIZES
     *
     * Five real shapes: two laptops, a small laptop, a tablet and a phone.
     * At 1024 and up the rail is a COLUMN; below the shell's own 900px
     * breakpoint it is the TOP STRIP — and at no width is the list lost.
     * ============================================================== */
    {
      await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1600);
      const SIZES = [[1440, 900, 'column'], [1280, 800, 'column'], [1024, 768, 'column'],
        [768, 1024, 'strip'], [390, 844, 'strip']];
      measured.sizes = [];
      for (const [w, h, want] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(900);
        const s = await page.evaluate(() => window.__opn.shape());
        const small = await page.evaluate(() => window.__opn.smallTargets(40));
        const occ = await page.evaluate(() => window.__opn.occluded());
        measured.sizes.push({ at: w + 'x' + h, want, cols: s.cols, rows: s.rows,
          rail: s.railRect, editor: s.editorRect, overflow: s.overflow, small: small.length, occluded: occ.length });
        eq(s.railShown, true, `at ${w}x${h} the patient rail is gone`);
        eq(s.rows, N_DAY, `at ${w}x${h} the rail shows ${s.rows} of ${N_DAY} patients — the list must never be lost`);
        ok(s.overflow <= 0, `at ${w}x${h} the room scrolls sideways by ${s.overflow}px`);
        if (want === 'column') {
          ok(s.railRect.right <= s.editorRect.x + 1,
            `at ${w}x${h} the rail must be a LEFT COLUMN, but it ends at ${s.railRect.right} and the pane starts at ${s.editorRect.x}`);
          ok(s.railRect.w >= 240 && s.railRect.w <= 340,
            `at ${w}x${h} the rail is ${s.railRect.w}px wide — outside the 240-340px band a patient list needs`);
        } else {
          ok(s.railRect.bottom <= s.editorRect.y + 1,
            `at ${w}x${h} the rail must be a TOP STRIP, but it ends at ${s.railRect.bottom} and the pane starts at ${s.editorRect.y}`);
          ok(s.railRect.h <= Math.round(h * 0.45),
            `at ${w}x${h} the top strip is ${s.railRect.h}px of a ${h}px window — it has eaten the note`);
          ok(s.editorRect.h >= 200,
            `at ${w}x${h} the note pane is only ${s.editorRect.h}px tall`);
        }
        assert.deepStrictEqual(small, [],
          `at ${w}x${h} these controls are under the 40px tap-target floor: ${JSON.stringify(small)}`);
        checks++;
        assert.deepStrictEqual(occ, [],
          `at ${w}x${h} these controls are painted over: ${JSON.stringify(occ)}`);
        checks++;
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(700);
    }

    /* ================================================================
     * 15. THE BUDGETS, AND THE FOLD GIVES EVERYTHING BACK
     * ============================================================== */
    {
      await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1800);
      const list = await page.evaluate(() => window.__opn.shape());
      measured.budgetList = list;
      /* opnote-day-3.0.1: budget 7 — the owner asked for the Templates button by name. */
      ok(list.railN <= 7,
        `the rail shows ${list.railN} controls that are not a patient: ${JSON.stringify(list.railIds)} (budget 7: ‹ day › Today search + Draft all + Templates)`);
      ok(list.paneN <= 1,
        `the note pane shows ${list.paneN} controls with nothing selected: ${JSON.stringify(list.paneIds)}`);
      await page.evaluate(() => window.__mlsOpDay.openNote(0));
      await page.waitForTimeout(1200);
      const note = await page.evaluate(() => window.__opn.shape());
      measured.budgetNote = note;
      ok(note.paneN <= 10,
        `the note pane shows ${note.paneN} controls (budget 10): ${JSON.stringify(note.paneIds)}`);
      /* A FOLD THAT CANNOT BE OPENED IS A DELETION — but what folds now is the
         rail's legacy CONTENT, never the rail. */
      await page.evaluate(() => window.__mlsSimpleLayer.set('guided'));
      await page.waitForTimeout(1000);
      const folded = await page.evaluate(() => ({
        rail: window.__opn.seen('#oprDayRail'),
        legacy: ['#opPrepModeRow', '#opPrepDayRow', '#oprTplRail'].filter((s) => window.__opn.seen(s)),
        shape: window.__opn.shape()
      }));
      eq(folded.rail, true,
        'the patient rail is folded in Simple — that is the exact thing the owner asked to have back');
      assert.deepStrictEqual(folded.legacy, [],
        `Simple still shows the rail's legacy content: ${JSON.stringify(folded.legacy)}`);
      checks++;
      await page.evaluate(() => window.__mlsSimpleLayer.set('full'));
      let back = { legacy: [], shape: null };
      for (let settle = 0; settle < 12 && back.legacy.length === 0; settle++) {
        await page.waitForTimeout(300);
        back = await page.evaluate(() => ({
          legacy: ['#opPrepModeRow', '#opPrepDayRow', '#oprTplRail'].filter((s) => window.__opn.seen(s)),
          shape: window.__opn.shape()
        }));
      }
      ok(back.legacy.length > 0,
        'switching to Everything gave none of the folded rail content back — the fold is a deletion');
      ok(back.shape.n > folded.shape.n,
        `Everything shows ${back.shape.n} controls and Simple shows ${folded.shape.n} — the fold gives nothing back`);
      measured.everything = back.shape.n;
      await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
      await page.waitForTimeout(700);
    }

    /* ================================================================
     * 16. THE ROOM IS CALM
     *
     * Owner, 2026-08-18: "matter of fact the whole op notes thing is bugging
     * out like crazy." MEASURED at f1efb4a2 (opnote-day-2.0.0), same fixture,
     * same instrument, room at rest for 10 s:
     *
     *     surface                     mutations/s   class writes   scroll jumps
     *     the day, nothing selected      3113.4        30,940            0
     *     one patient open               3127.4        31,060            0
     *
     * Two unconditional writers, each feeding an observer that repainted them:
     * opnote-day's own fold registry (remove-then-add on every pass) and
     * msl-1.0.0's paintCards/foldOne (setAttribute on every pass). Both are
     * idempotent now, opnote-day's observers are re-entrancy-guarded and
     * coalesced at 60 ms, and msl asks the room which card is open instead of
     * fighting it for the attribute.
     * ============================================================== */
    {
      await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(3000);

      /* THE INSTRUMENT MUST BE ABLE TO FAIL. If the watcher cannot see the
         app's own repaint, every zero below is a lie about a dead observer. */
      const burst = await page.evaluate(async () => {
        const p = window.__opn.watch(2000);
        for (let i = 0; i < 6; i++) { try { opPrepRender(); } catch (e) {} await new Promise((r) => setTimeout(r, 200)); }
        return p;
      });
      ok(burst.total > 100,
        `the mutation watcher saw only ${burst.total} records across six forced repaints — it is not measuring the room`);
      measured.calmCanary = burst.total;

      await page.waitForTimeout(2000);
      const restList = await page.evaluate(() => window.__opn.watch(8000));
      measured.calmList = restList;
      /* TWO NUMBERS, BECAUSE THE ROOM IS SHARED. The first is this lane's own
         surfaces — the rail, the note pane, the empty pane — and it is the one
         that must be still. The second is the whole modal, against the 3,113/s
         that 2.0.0 measured; anything left in it is named in the message so a
         regression says WHOSE it is rather than "the room is busy". */
      ok(restList.minePerSec <= 2,
        `the RAIL AND PANE, at rest, mutate ${restList.minePerSec}/s (budget 2/s) — this lane's own surfaces must be still: ${JSON.stringify(restList.topTargets)} ${JSON.stringify(restList.attrs)}`);
      ok(restList.perSec <= 60,
        `the room as a whole mutates ${restList.perSec}/s at rest against 3,113/s at opnote-day-2.0.0 (ceiling 60/s): ${JSON.stringify(restList.topTargets)} ${JSON.stringify(restList.attrs)}`);
      eq(restList.jumpN, 0,
        `the room's scroll position moved ${restList.jumpN} times while nobody touched it: ${JSON.stringify(restList.jumps)}`);
      /* ONE ANIMATED THING, AND IT IS THE GLOW. Counted by playState, not by
         computed style: a FINISHED one-shot still reports its animation-name
         forever in computed style, and the room's own entrance is one. */
      ok(restList.anims.length <= 1,
        `${restList.anims.length} things are animating in the room at rest — only the single next-step halo may: ${JSON.stringify(restList.anims)}`);
      if (restList.anims.length === 1) {
        eq(restList.anims[0].next, true,
          `the one animation in the room is not on the glowing next step: ${JSON.stringify(restList.anims[0])}`);
      }

      /* the same, with one patient's note open and a Fields box on screen */
      await page.evaluate(async (body) => {
        const rows = window._opPrep || [];
        rows.forEach((r) => { r.gen = true; r.note = body; });
        opPrepRender();
        await new Promise((x) => setTimeout(x, 1200));
        window.__mlsOpDay.openNote(3);
      }, LONG_NOTE.replace('FINDINGS:', 'FINDINGS:\nProvider NPI [[provider_npi]] on file.'));
      await page.waitForTimeout(3500);
      const restNote = await page.evaluate(() => window.__opn.watch(8000));
      measured.calmNote = restNote;
      ok(restNote.minePerSec <= 2,
        `the RAIL AND PANE, with a note open, mutate ${restNote.minePerSec}/s (budget 2/s): ${JSON.stringify(restNote.topTargets)} ${JSON.stringify(restNote.attrs)}`);
      ok(restNote.perSec <= 60,
        `the room as a whole mutates ${restNote.perSec}/s with a note open against 3,113/s at opnote-day-2.0.0 (ceiling 60/s): ${JSON.stringify(restNote.topTargets)} ${JSON.stringify(restNote.attrs)}`);
      eq(restNote.jumpN, 0,
        `the note pane's scroll position moved ${restNote.jumpN} times while nobody touched it: ${JSON.stringify(restNote.jumps)}`);
      ok(restNote.anims.length <= 1,
        `${restNote.anims.length} things are animating on the note at rest: ${JSON.stringify(restNote.anims)}`);
      if (restNote.anims.length === 1) {
        eq(restNote.anims[0].next, true,
          `the one animation on the note is not on the glowing next step: ${JSON.stringify(restNote.anims[0])}`);
      }

      /* THE YELLOW BOX DOES NOT FLASH. Owner, 2026-08-18, of the Fields box at
         the top of the note: "this top yellow thing flashes back and forth and
         I don't like it." Asserted while a field genuinely still needs a
         value, or the check is about an empty box. */
      const fb = await page.evaluate(() => window.__opn.fieldsBox());
      measured.fields = fb;
      ok(fb.box, `no Fields box is on the note, so the flashing check proved nothing: ${JSON.stringify(fb)}`);
      ok(fb.needs > 0,
        `the Fields box has no field waiting for a value (${JSON.stringify(fb)}) — the owner's complaint is about the state where one does`);
      assert.deepStrictEqual(fb.anim, [],
        `the Fields box (or something in it) still animates while a field needs a value: ${JSON.stringify(fb.anim)}`);
      checks++;
      assert.deepStrictEqual(fb.running, [],
        `these nodes inside the Fields box have a RUNNING animation: ${JSON.stringify(fb.running)}`);
      checks++;
      /* and the glow in this state is a control the doctor can PRESS, carrying
         a halo that actually renders — never the box's border */
      const gField = await settleGlow(page);
      const haloField = await haloOf(page);
      measured.glowFields = { id: gField.id, want: gField.want, count: gField.count,
        halo: haloField && (haloField.tag + ' anim=' + haloField.anim + ' running=' + haloField.running) };
      eq(gField.count, 1, `${gField.count} controls glow with a field waiting: ${JSON.stringify(gField.lit)}`);
      const litIsControl = await page.evaluate(() => {
        const e = document.querySelector('[data-mls-next="1"]');
        if (!e) return null;
        return { tag: e.tagName, id: e.id || '',
          inBox: !!e.closest('.onf-fillbox'),
          isBox: !!(e.classList && e.classList.contains('onf-fillbox')),
          text: (e.textContent || '').trim().slice(0, 40) };
      });
      ok(litIsControl, 'nothing is glowing while a field waits for a value');
      eq(litIsControl.isBox, false, 'the glow is on the Fields box itself rather than on a control inside it');
      ok(/^(BUTTON|A)$/.test(litIsControl.tag),
        `the glow is on a <${litIsControl.tag}> — a replaced element carries no ::after, so the halo would be invisible: ${JSON.stringify(litIsControl)}`);
      ok(haloField && haloField.content !== 'none' && haloField.running >= 1,
        `the glowing control's halo is not rendering: ${JSON.stringify(haloField)}`);
      /* the honest either/or: the fill module's own action button when it has
         one, else the pane's "Fill N fields" which focuses that same field */
      ok(litIsControl.inBox || litIsControl.id === 'mlsOpnGo',
        `the glow is on "${litIsControl.id || litIsControl.text}", which is neither the waiting field's own action nor the pane's Fill action`);

      /* THE PANE DOES NOT RE-MOUNT while the app repaints under it — twenty
         real opPrepRender() calls, the repaint a streaming draft causes. */
      const ident = await page.evaluate(() => window.__opn.identity(20));
      measured.identity = ident;
      const remounted = Object.keys(ident).filter((k) => ident[k] !== 'same');
      assert.deepStrictEqual(remounted, [],
        `these room surfaces were rebuilt by 20 repaints instead of surviving them: ${JSON.stringify(ident)}`);
      checks++;

      /* THE BLOCK'S OWN GUARDS, read out of the shipped shell so a future
         edit that removes them fails here rather than in the owner's room. */
      const guards = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
      const span = guards.slice(guards.indexOf('<!-- ===== opnote-day-3.0.0'),
        guards.indexOf('<!-- ===== end opnote-day-3.0.0'));
      ok(/var painting = false;/.test(span) && /if \(painting\) return;/.test(span),
        'the op-note room lost its re-entrancy guard, so its own writes wake it again');
      ok(/var COALESCE = 60;/.test(span),
        'the op-note room lost its coalescing window, so one repaint costs many paints');
      ok(!/attributeFilter: \['class'\], subtree: true/.test(span),
        "the op-note room watches `class` across its own subtree again — every .opr-cur it writes feeds itself");
      ok(/function setClass\(node, cls, want\)/.test(span),
        'the fold registry no longer writes classes idempotently — that is the 3,113/s defect');
    }

    eq(pageErrors.length, 0, `the shell threw during the run: ${JSON.stringify(pageErrors.slice(0, 3))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

/* ============================================ PART 3: the causal control ===
 * The same instrument, the same synthetic day, against the shell as it was
 * BEFORE any of this existed. Without this, every number above could be an
 * artefact of the harness rather than of the change.
 * ========================================================================= */
async function control() {
  const baselineFile = path.join(os.tmpdir(), 'mls-opnote-rail-baseline-' + process.pid + '.html');
  const baseline = execFileSync('git', ['show', PREFIX + ':1pScribeFlow.html'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(baselineFile, baseline);
  ok(String(baseline).indexOf('opnote-day-') < 0,
    'the pinned control commit already carries an opnote-day block — it is not a pre-fix control');

  const { srv, port } = await serve(baselineFile);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await bootShell(page, `http://127.0.0.1:${port}/1pScribeFlow.html`);
    await page.evaluate(harness, { DAY, DAY_NEXT });
    await page.evaluate(() => window.__opn.seed());
    await page.evaluate(() => { try { window.__mlsAutoDraft.setEnabled(false); } catch (e) {} });
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(2500);
    const before = await page.evaluate(() => window.__opn.shape());
    measured.control = before;
    eq(before.state, '',
      `the pre-fix shell already exposes a room state ("${before.state}") — the control is not a control`);
    eq(before.rows, 0,
      `the pre-fix shell already lists ${before.rows} patients as rail buttons — the control is not a control`);
    ok(before.editors > 1,
      `the pre-fix shell showed ${before.editors} note editors at rest; one editor per patient is the defect this replaces`);
    ok(before.n > (measured.budgetList ? measured.budgetList.n : 999),
      `the pre-fix room showed ${before.n} non-patient controls and the rebuilt one shows ${measured.budgetList && measured.budgetList.n} — the change did not reduce the surface`);
    /* none of this block's controls exist there at all */
    const sw = await page.evaluate(() => ['mlsOpnRail', 'mlsOpnPrevDay', 'mlsOpnNextDay', 'mlsOpnDayIn',
      'mlsOpnSearch', 'mlsOpnGo', 'mlsOpnHist', 'mlsOpnPick']
      .filter((id) => !!document.getElementById(id)));
    assert.deepStrictEqual(sw, [], `the pre-fix shell already has ${JSON.stringify(sw)}`);
    checks++;
  } finally {
    await browser.close();
    srv.close();
    try { fs.unlinkSync(baselineFile); } catch (e) {}
  }
}

runtime()
  .then(control)
  .then(() => {
    console.log(`1p-opnote-rail-runtime: ${checks} checks passed`);
    const f = (m) => (m ? `${m.n} controls (${m.railN} rail / ${m.paneN} pane), ${m.rows} patients, ${m.editors} editors` : 'n/a');
    console.log(`  BEFORE (pre-fix ${PREFIX.slice(0, 8)}) op-note room: ${f(measured.control)}`);
    console.log(`  AFTER  the day, nothing selected      : ${f(measured.budgetList)}`);
    console.log(`  AFTER  one patient open               : ${f(measured.budgetNote)}`);
    console.log(`  AFTER  rail controls                  : ${JSON.stringify(measured.budgetList && measured.budgetList.railIds)}`);
    console.log(`  AFTER  note-pane controls             : ${JSON.stringify(measured.budgetNote && measured.budgetNote.paneIds)}`);
    console.log(`  AFTER  Everything mode                : ${measured.everything} controls`);
    console.log(`  AFTER  rail button height             : ${measured.buttonHeight}`);
    console.log(`  AFTER  empty pane says                : ${JSON.stringify(measured.pick)}`);
    console.log(`  AFTER  header chips                   : ${JSON.stringify(measured.chips)}`);
    console.log(`  AFTER  quiet run status               : ${JSON.stringify(measured.notice)}`);
    console.log(`  AFTER  Open in History                : ${JSON.stringify(measured.hist)}`);
    console.log(`  AFTER  taskbar clearance              : ${JSON.stringify(measured.fit)}`);
    console.log('  --- CALM (owner: "bugging out like crazy") ---');
    console.log(`  BEFORE (opnote-day-2.0.0 @ f1efb4a2)  : 3113.4 mutations/s at rest (30,940 class writes / 10 s), 0 scroll jumps`);
    const c = (m) => (m ? `rail+pane ${m.minePerSec}/s, whole room ${m.perSec}/s (${m.total} in ${m.secs}s), jumps ${m.jumpN}, animating ${m.anims.length}${m.anims.length ? ' ' + JSON.stringify(m.anims) : ''}` : 'n/a');
    console.log(`  AFTER  the day at rest                : ${c(measured.calmList)}`);
    console.log(`  AFTER    top targets                  : ${JSON.stringify(measured.calmList && measured.calmList.topTargets)}`);
    console.log(`  AFTER  one note at rest               : ${c(measured.calmNote)}`);
    console.log(`  AFTER    top targets                  : ${JSON.stringify(measured.calmNote && measured.calmNote.topTargets)}`);
    console.log(`  AFTER  watcher canary (6 repaints)    : ${measured.calmCanary} records`);
    console.log(`  AFTER  Fields box                     : ${JSON.stringify(measured.fields)}`);
    console.log(`  AFTER  glow with a field waiting      : ${JSON.stringify(measured.glowFields)}`);
    console.log(`  AFTER  identity across 20 repaints    : ${JSON.stringify(measured.identity)}`);
    console.log(`  AFTER  formatted view on open         : ${JSON.stringify(measured.fmt)}`);
    (measured.glow || []).forEach((g) => {
      console.log(`  GLOW   ${g.where.padEnd(38)}: ${g.got} (count ${g.count}, state ${g.state})`);
    });
    (measured.sizes || []).forEach((s) => {
      console.log(`  SIZE   ${s.at.padEnd(10)} ${s.want.padEnd(7)}: cols "${s.cols}" rail ${JSON.stringify(s.rail)} pane ${JSON.stringify(s.editor)} overflow ${s.overflow} small ${s.small} occluded ${s.occluded}`);
    });
    (measured.place || []).forEach((p) => {
      console.log(`  PLACE  @${p.tag.padEnd(5)}                        : day switcher top ${p.headTop}px, scrollers ${JSON.stringify(p.scrollers)}, occluded ${p.occluded.length}`);
    });
  })
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
