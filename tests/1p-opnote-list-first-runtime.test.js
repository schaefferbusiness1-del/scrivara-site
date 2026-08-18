/* CAUSAL CONTROL PIN (2026-08-17): the control engine is the pre-fix commit
   1e0151a4 (main before batch 7), NOT the moving origin/main — once this ships,
   origin/main carries it and a control against it would prove nothing. */
'use strict';

/* /1p OP NOTES — THE DAY IS A LIST, AND ONE PATIENT AT A TIME
 *
 * Owner, 2026-08-17, after two rounds of op-note UI: "man tbh I don't even
 * like the new op notes layout — try again and make it even better, more
 * simple and intuitive. Also ALWAYS start on all scheduled patients." Plus,
 * the same night: "it should be WAY easier to switch days", "the formatted
 * view should always start hidden and only expand if you click it", and of the
 * PROCEDURE card "I should have to click this to open it up, it's so annoying."
 *
 * MEASURED BEFORE (this worktree at claude/fable-lanes-20260817, real Chrome,
 * 14 synthetic patients, 1366x900):
 *
 *     mode        controls that are not a patient row   note editors on screen
 *     Simple                 10                                   1
 *     Normal                 14                                  14
 *     Everything             79                                  14
 *
 * Fourteen full note editors on one screen — each with its own procedure
 * input, template dropdown, Match-template button and Draft button — is the
 * "way too busy" being reported. The properties below are what "simple" means
 * as something a machine can check:
 *
 *   1.  The room lands on the DAY'S SCHEDULED PATIENTS — every appointment row
 *       of the selected day, one row each, and exactly the rows the app's own
 *       _opApptsForDay() returns. Proven on a 24-patient day, a 3-patient day
 *       and a day with none.
 *   2.  The day switcher moves the day and re-lists it: arrows, the date
 *       picker, Today, and the left/right keys.
 *   3.  Row status is DERIVED from what is stored, including a finalized note
 *       in the chart.
 *   4.  A row opens THAT patient's note surface, and the surface is bound to
 *       that row: the patient, the day and the appointment id.
 *   5.  The formatted view and the procedure/appointment card both start SHUT,
 *       on every open, with no remembered state.
 *   6.  Esc goes back to the list (it does NOT throw the room away) and the
 *       arrow keys move between patients.
 *   7.  An empty day is never a blank room, and its one action is the app's
 *       OWN day pull — not a second pull implementation.
 *   8.  The Templates duplicate: every Templates button outside the room says
 *       where it goes, and the note surface carries its own way in.
 *   9.  Busyness budgets, counted.
 *  10.  Both twins carry the block byte-identically.
 *  11.  CAUSAL CONTROL: the same measurements against the pre-fix shell, so
 *       every number above is attributable to this block and not to the
 *       harness.
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
const DAY = '2026-08-17';        /* 24 patients */
const DAY_NEXT = '2026-08-18';   /* 3 patients  */
const DAY_PREV = '2026-08-16';   /* none        */

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ===================================================== PART 1: static ===== */
{
  const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');
  const OPEN = '<!-- ===== opnote-day-2.0.0';
  const CLOSE = '<!-- ===== end opnote-day-2.0.0';
  const a = read('1pScribeFlow.html');
  const b = read('1p/index.html');
  for (const [name, src] of [['1pScribeFlow.html', a], ['1p/index.html', b]]) {
    eq(src.split(OPEN).length - 1, 1, `${name}: the block must open exactly once`);
    eq(src.split(CLOSE).length - 1, 1, `${name}: the block must close exactly once`);
    const span = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));
    /* the room's own generator calls are DRIVEN, never re-implemented: this
       block must never build its own AI request, its own save, or its own
       Athena write */
    for (const forbidden of ['aiCallRaw', 'fetch(', '_genOpNote', 'saveNotes(', 'getNotes()['] ) {
      ok(span.indexOf(forbidden) < 0,
        `${name}: the op-note list block calls ${forbidden} — it must drive the app's own controls, never re-implement drafting, saving or the Athena write`);
    }
    /* and it must not weaken the day-brain's safety filter */
    ok(!/markSolo|statesNoProcedure|PROC_WORD|verdict\s*=\s*'needs'/.test(span),
      `${name}: the op-note list block reaches into the day-brain's triage`);
    /* the three "never folded" controls */
    for (const never of ['#opPrepGenAllBtn', '#tpfStop', '.modal-x', '#oprBack']) {
      ok(!new RegExp("sel: '" + never.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'").test(span),
        `${name}: the block folds ${never} through its registry, which must never happen`);
    }
    /* the state attribute the guided-glow lane consumes */
    ok(span.indexOf('data-mls-opnotes-state') > 0, `${name}: the block no longer exposes its room state`);
    ok(span.indexOf('data-mls-opnotes-next') > 0, `${name}: the block no longer exposes its next control`);
  }
  /* 10. the twins carry the same block, byte for byte */
  const sliceOf = (s) => s.slice(s.indexOf(OPEN), s.indexOf(CLOSE) + CLOSE.length);
  eq(sliceOf(a), sliceOf(b), 'the twins carry different opnote-day-2.0.0 blocks');
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
    'Max Sample', 'Nia Sample', 'Oz Sample', 'Pia Sample', 'Quin Sample', 'Rae Sample',
    'Sid Sample', 'Tex Sample', 'Uma Sample', 'Val Sample', 'Wes Sample', 'Xan Sample'];
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

  window.__opn = {
    visible: visible,
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
    /* every visible control in the room that is NOT one of the per-patient
       rows — the number the owner's budget is about */
    chrome: function () {
      var modal = document.getElementById('opPrepModal');
      if (!modal) return null;
      var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button],' +
        '[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=tab]';
      var all = Array.prototype.slice.call(modal.querySelectorAll(CTRL)).filter(visible);
      var chrome = all.filter(function (e) { return !(e.closest && e.closest('.mlsOpDayCard')); });
      return {
        n: chrome.length,
        ids: chrome.map(function (e) {
          return e.id || (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28) || e.tagName;
        }),
        rows: Array.prototype.slice.call(modal.querySelectorAll('.mlsOpDayCard')).filter(visible).length,
        editors: Array.prototype.slice.call(modal.querySelectorAll('#opPrepList > div')).filter(visible).length,
        state: String(modal.getAttribute('data-mls-opnotes-state') || ''),
        next: String(modal.getAttribute('data-mls-opnotes-next') || '')
      };
    },
    /* the rows as the doctor reads them */
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
          act: (c.querySelector('.mlsOpDayAct') || {}).textContent || '',
          h: Math.round(c.getBoundingClientRect().height)
        };
      });
    },
    /* press a row the way a doctor does */
    pressRow: function (i) {
      var b = document.getElementById('mlsOpnRow' + i);
      if (!b) return false;
      b.click();
      return true;
    },
    press: function (id) { var b = document.getElementById(id); if (!b) return false; b.click(); return true; },
    seen: function (sel) { var e = document.querySelector(sel); return !!(e && visible(e)); },
    /* the identity the note surface is bound to, read off the app's own
       stamp rather than off this block */
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
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'opnote-list@mlsscribe.test'; });
}

async function runtime() {
  const { srv, port } = await serve(null);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  try {
    await bootShell(page, `http://127.0.0.1:${port}/1pScribeFlow.html`);
    await page.evaluate(harness, { DAY, DAY_NEXT });
    const seeded = await page.evaluate(() => window.__opn.seed());
    eq(seeded.patients, 27, `the synthetic roster did not land: ${JSON.stringify(seeded)}`);
    eq(seeded.appts, 27, `the synthetic schedule did not land: ${JSON.stringify(seeded)}`);
    /* Automatic drafting is the app's own behaviour and is proven by
       1p-ui-shape-contract; here it would make every status non-deterministic
       (there is no backend, so every draft fails). Turned off for this run
       ONLY, and its precondition is asserted directly below instead. */
    await page.evaluate(() => { try { window.__mlsAutoDraft.setEnabled(false); } catch (e) {} });
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));

    /* ================================================================
     * 1. THE LIST IS THE DAY — ALL OF IT
     * ============================================================== */
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(2200);
    const expected = await page.evaluate((d) => window.__opn.scheduled(d), DAY);
    ok(Array.isArray(expected) && expected.length === 24,
      `the app's own _opApptsForDay returned ${expected && expected.length} rows for the 24-patient day — the premise of this suite`);
    let listed = await page.evaluate(() => window.__opn.listed());
    assert.deepStrictEqual(listed.map((r) => r.name), expected,
      `the room lists ${listed.length} patients for a day the app says has ${expected.length}, or lists them in a different order`);
    checks++;
    let chrome = await page.evaluate(() => window.__opn.chrome());
    measured.list24 = chrome;
    eq(chrome.state, 'list', `the room did not land on the day list (state="${chrome.state}")`);
    eq(chrome.editors, 0,
      `the day list is showing ${chrome.editors} note editors — the list is a list, and the editor belongs to one patient at a time`);
    /* every row carries the four things the owner asked for */
    for (const r of listed.slice(0, 5)) {
      ok(/\d/.test(r.time), `a row shows no appointment time: ${JSON.stringify(r)}`);
      ok(r.name.trim().length > 0, `a row shows no patient name: ${JSON.stringify(r)}`);
      ok(r.proc.trim().length > 0, `a row shows no procedure line: ${JSON.stringify(r)}`);
      ok(r.chip.trim().length > 0, `a row shows no status: ${JSON.stringify(r)}`);
      ok(/Draft op note|Open note/.test(r.act), `a row offers no action: ${JSON.stringify(r)}`);
    }
    /* THE AUTODRAFT PRECONDITION. msl-autodraft refuses when
       #opPrepGenAllBtn.offsetParent is null, so folding it would silently turn
       "always start on all scheduled patients" off. */
    const genVisible = await page.evaluate(() => {
      const b = document.getElementById('opPrepGenAllBtn');
      return { present: !!b, offsetParent: !!(b && b.offsetParent), text: b ? b.textContent : '' };
    });
    ok(genVisible.offsetParent,
      `#opPrepGenAllBtn has a null offsetParent on the day list — msl-autodraft would report "button-unavailable" and never start: ${JSON.stringify(genVisible)}`);
    ok(/24/.test(genVisible.text),
      `the Draft-all button does not say how many notes the day needs: "${genVisible.text}"`);

    /* ================================================================
     * 2. THE DAY SWITCHER — arrows, picker, Today, keyboard
     * ============================================================== */
    ok(await page.evaluate(() => window.__opn.press('mlsOpnNextDay')), 'the next-day arrow is missing');
    await page.waitForTimeout(1400);
    let day = await page.evaluate(() => window.__mlsOpDay.day());
    eq(day, DAY_NEXT, 'the next-day arrow did not move the day');
    listed = await page.evaluate(() => window.__opn.listed());
    eq(listed.length, 3, `the 3-patient day lists ${listed.length} rows`);
    ok(await page.evaluate(() => window.__opn.press('mlsOpnPrevDay')), 'the previous-day arrow is missing');
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => window.__opn.press('mlsOpnPrevDay')), 'the previous-day arrow vanished');
    await page.waitForTimeout(1400);
    day = await page.evaluate(() => window.__mlsOpDay.day());
    eq(day, DAY_PREV, 'two presses of the previous-day arrow did not land on the empty day');

    /* ---- 7. an empty day is never a blank room --------------------- */
    chrome = await page.evaluate(() => window.__opn.chrome());
    measured.empty = chrome;
    eq(chrome.state, 'empty', `a day with no appointments is in state "${chrome.state}"`);
    const emptyText = await page.evaluate(() => {
      const e = document.getElementById('mlsOpnEmpty');
      return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : '';
    });
    ok(/No scheduled patients on/i.test(emptyText) && /August/i.test(emptyText),
      `the empty day does not name the day it is empty on: "${emptyText}"`);
    eq(chrome.next, 'mlsOpnPull',
      `the empty day's guided next step is "${chrome.next}", not the pull button`);
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
    /* the room must still be open — the pull button closed it, so re-open */
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(1600);
    listed = await page.evaluate(() => window.__opn.listed());
    eq(listed.length, 24, `back on the 24-patient day the room lists ${listed.length} rows`);

    /* ---- the left/right keys move the day from the list ------------ */
    await page.evaluate(() => { try { document.activeElement.blur(); } catch (e) {} document.body.focus(); });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1400);
    eq(await page.evaluate(() => window.__mlsOpDay.day()), DAY_NEXT,
      'the right-arrow key did not move the day forward from the list');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(1400);
    eq(await page.evaluate(() => window.__mlsOpDay.day()), DAY, 'the left-arrow key did not move the day back');

    /* ---- the search box filters the list --------------------------- */
    await page.evaluate(() => { const s = document.getElementById('mlsOpnSearch'); s.value = 'Ivy'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(500);
    listed = await page.evaluate(() => window.__opn.listed());
    eq(listed.length, 1, `searching for one patient left ${listed.length} rows on screen`);
    eq(listed[0].name, 'Ivy Sample', `the search matched ${listed[0].name}`);
    await page.evaluate(() => { const s = document.getElementById('mlsOpnSearch'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(500);

    /* ================================================================
     * 3. STATUS IS DERIVED FROM WHAT IS STORED
     * ============================================================== */
    await page.evaluate(() => {
      const rows = window._opPrep || [];
      const led = document.getElementById('tpfLedgerList'); if (led) led.innerHTML = '';
      rows.forEach((r, i) => { delete r._genErr; delete r._lastDraftErr; delete r._noteId; r.gen = false; r.note = ''; });
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
    await page.waitForTimeout(700);
    listed = await page.evaluate(() => window.__opn.listed());
    const byIdx = {};
    listed.forEach((r) => { byIdx[r.i] = r; });
    eq(byIdx[0].state, 'queued', `an untouched row reads "${byIdx[0].state}" (${byIdx[0].chip})`);
    eq(byIdx[1].state, 'ready', `a finished draft reads "${byIdx[1].state}" (${byIdx[1].chip})`);
    eq(byIdx[2].state, 'review', `a draft with blanks reads "${byIdx[2].state}" (${byIdx[2].chip})`);
    ok(/blank/i.test(byIdx[2].why),
      `a row needing review does not say what is missing: "${byIdx[2].why}"`);
    eq(byIdx[3].state, 'failed', `a failed draft reads "${byIdx[3].state}" (${byIdx[3].chip})`);
    ok(byIdx[3].why.trim().length > 3, `a failed row carries no reason: "${byIdx[3].why}"`);
    /* CONSISTENT CARD HEIGHT (owner, 02:30Z: "make it calmer"). A card whose
       reason line wraps is what made the previous grid ragged; every card here
       is four one-line rows by construction. */
    const heights = listed.map((r) => r.h);
    const spread = Math.max.apply(null, heights) - Math.min.apply(null, heights);
    ok(spread <= 2,
      `the cards span ${spread}px of height (${JSON.stringify(Array.from(new Set(heights)))}) — every card must be the same height. 2px is sub-pixel line rounding, not a wrapped line: one wrapped reason line is ~17px.`);
    measured.cardHeight = Math.max.apply(null, heights) + 'px (spread ' + spread + 'px)';
    eq(byIdx[4].state, 'filed',
      `a note that is finalized in the chart reads "${byIdx[4].state}" (${byIdx[4].chip}) — status must follow what is stored`);
    /* the action word follows the state */
    eq(byIdx[0].act.indexOf('Draft op note'), 0, `an undrafted row offers "${byIdx[0].act}"`);
    eq(byIdx[1].act.indexOf('Open note'), 0, `a drafted row offers "${byIdx[1].act}"`);
    /* and the guided next step on the list is the first patient with no note */
    chrome = await page.evaluate(() => window.__opn.chrome());
    eq(chrome.next, 'mlsOpnRow0',
      `the list's guided next step is "${chrome.next}", not the first patient without a note`);

    /* ================================================================
     * 4. A ROW OPENS THAT PATIENT'S NOTE, BOUND TO THAT APPOINTMENT
     * ============================================================== */
    ok(await page.evaluate(() => window.__opn.pressRow(7)), 'row 7 could not be pressed');
    await page.waitForTimeout(900);
    chrome = await page.evaluate(() => window.__opn.chrome());
    measured.note = chrome;
    eq(chrome.state, 'note', `pressing a patient row left the room in state "${chrome.state}"`);
    eq(chrome.editors, 1,
      `the note surface shows ${chrome.editors} editors — exactly one patient's note belongs on it`);
    eq(chrome.next, 'mlsOpnGo', `the note surface's guided next step is "${chrome.next}"`);
    const bind = await page.evaluate(() => window.__opn.binding());
    eq(bind.sel, 7, `pressing row 7 selected row ${bind.sel}`);
    eq(bind.name, listed.find((r) => r.i === 7).name,
      `the note surface opened on ${bind.name} after pressing ${listed.find((r) => r.i === 7).name}'s row`);
    eq(bind.patientId, 'syn-7', `the note surface is bound to patient ${bind.patientId}`);
    eq(bind.dateKey, DAY, `the note surface is bound to day ${bind.dateKey}`);
    /* the appointment id, resolved by the app's own stamp from the day's
       schedule-import ledger — the third factor of the binding */
    eq(bind.stamp && bind.stamp.appointmentId, '5550007',
      `the note surface's appointment binding is ${JSON.stringify(bind.stamp)} — a draft must bind to the exact appointment`);
    eq(bind.stamp && bind.stamp.visitDate, DAY, `the visit stamp's day is ${bind.stamp && bind.stamp.visitDate}`);
    /* the header says who and what */
    const head = await page.evaluate(() => ({
      name: (document.getElementById('mlsOpnName') || {}).textContent || '',
      sub: (document.getElementById('mlsOpnSub') || {}).textContent || '',
      go: (document.getElementById('mlsOpnGo') || {}).textContent || ''
    }));
    eq(head.name, bind.name, `the note surface's heading says "${head.name}"`);
    ok(/\d/.test(head.sub), `the note surface does not show the appointment time or day: "${head.sub}"`);
    ok(/Generate op note/.test(head.go),
      `an undrafted patient's one action is "${head.go}", not Generate`);

    /* THE GENERATOR IS THE APP'S OWN, CALLED FOR THIS ROW AND NO OTHER. */
    const gen = await page.evaluate(async () => {
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
    assert.deepStrictEqual(gen.calls, [7],
      `pressing Generate on patient 7's note surface called the drafter for ${JSON.stringify(gen.calls)} — a note must draft against the row it is showing`);
    checks++;
    /* and the one action moved on */
    await page.waitForTimeout(600);
    const go2 = await page.evaluate(() => (document.getElementById('mlsOpnGo') || {}).textContent || '');
    ok(/Save to/.test(go2), `after a clean draft the one action is "${go2}", not Save`);

    /* ================================================================
     * 5. THE NOTE COMES EXPANDED, AND THE GREEN BAR IS GONE
     *
     * Owner, 2026-08-17 02:30Z, looking at the room: "I HATE THAT GREEN BAR
     * and I hate how it doesn't come expanded."
     *
     * The bar is _opPreviewHtml()'s hero — a full-width dark-green gradient
     * panel that is the FIRST child of every card opPrepRender() builds.
     * Collapsing it was the wrong answer (it puts the note one click further
     * away); it is retired from the note surface, and the note itself is on
     * screen the moment the card is pressed, with nothing to click first.
     * ============================================================== */
    let open7 = await page.evaluate(() => ({
      note: window.__opn.seen('#opPrepNote_7'),
      hero: window.__opn.seen('#opPrepPrev_7'),
      /* the header that replaced the bar */
      name: window.__opn.seen('#mlsOpnName'),
      sub: window.__opn.seen('#mlsOpnSub'),
      go: window.__opn.seen('#mlsOpnGo'),
      /* the raw metadata and the template picker are the only things behind a
         line — never the note */
      proc: window.__opn.seen('#opPrepProc_7'),
      tpl: window.__opn.seen('#opPrepTpl_7'),
      det: (document.getElementById('mlsOpnDet') || {}).getAttribute('aria-expanded')
    }));
    eq(open7.note, true,
      'the note text is not on screen when a patient card is pressed — the note must come expanded, with no click first');
    /* THE NAMED CAUSE, so a regression says what broke rather than "not
       visible". msl-1.0.0 marks every op-note card data-msl-card="shut" except
       the one index it remembers, and its own rule then hides every child of a
       shut card except the green hero. Measured on the real page by disabling
       one stylesheet at a time: the note surface was a 26px collapsed bar. */
    eq(await page.evaluate(() => {
      const c = document.querySelector('#opPrepList > div.opr-cur');
      return c ? c.getAttribute('data-msl-card') : 'no current card';
    }), 'open',
      'the card the note surface is showing is not marked open, so msl-1.0.0 collapses it to the green bar and hides the note');
    eq(open7.hero, false,
      'the dark-green PROCEDURE bar is still on the note surface');
    eq(open7.name, true, 'the note surface shows no patient name');
    eq(open7.sub, true, 'the note surface shows no procedure/day line');
    eq(open7.go, true, 'the note surface shows no action');
    eq(open7.proc, false, 'the raw procedure field is open before anyone asked for it');
    eq(open7.tpl, false, 'the template picker is open before anyone asked for it');
    eq(open7.det, 'false', 'the details disclosure does not report itself shut');

    /* NO BIG COLOURED PANEL ANYWHERE ON THIS SURFACE. Measured, not asserted
       by class name: any visible node in the note surface (or in the one card
       it shows) taller than 56px that paints a gradient is the bar coming
       back under another name. */
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
      `the note surface still paints a full-height coloured slab: ${JSON.stringify(slabs)} — the owner asked for a small plain header, not a bar`);
    checks++;
    /* what the bar carried is on the header instead, as plain chips */
    const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#mlsOpnChips .mlsOpnChip')).map((c) => c.textContent));
    ok(chips.length > 0,
      'the side/level chips the green bar used to carry are nowhere on the note surface — that information was deleted, not moved');
    measured.chips = chips;

    /* ---- a note WITH blanks shows them inline, also with no click ---- */
    await page.evaluate(() => window.__opn.pressRow(2));
    await page.waitForTimeout(900);
    let blanks = await page.evaluate(() => ({
      note: window.__opn.seen('#opPrepNote_2'),
      fill: window.__opn.seen('#opPrepList > div.opr-cur .onf-fillbox'),
      go: (document.getElementById('mlsOpnGo') || {}).textContent || ''
    }));
    for (let settle = 0; settle < 10 && !blanks.fill; settle++) {
      await page.waitForTimeout(400);
      blanks = await page.evaluate(() => ({
        note: window.__opn.seen('#opPrepNote_2'),
        fill: window.__opn.seen('#opPrepList > div.opr-cur .onf-fillbox'),
        go: (document.getElementById('mlsOpnGo') || {}).textContent || ''
      }));
    }
    eq(blanks.note, true, 'a note with blanks does not show its text when the card is pressed');
    eq(blanks.fill, true,
      'the fields still to fill are not on screen when the card is pressed — the blanks belong with the note, not behind a click');
    ok(/Fill \d+ field/.test(blanks.go),
      `a note with blanks offers "${blanks.go}" rather than filling them`);

    /* ---- the two disclosures still hold the raw metadata, and open --- */
    await page.evaluate(() => window.__opn.pressRow(7));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__opn.press('mlsOpnDet'));
    await page.waitForTimeout(400);
    eq(await page.evaluate(() => window.__opn.seen('#opPrepProc_7')), true,
      'clicking the details disclosure did not reveal the procedure field — a fold that cannot open is a deletion');
    await page.evaluate(() => window.__opn.press('mlsOpnTplBtn'));
    await page.waitForTimeout(400);
    const tplOpen = await page.evaluate(() => ({
      sel: window.__opn.seen('#opPrepTpl_7'), lib: window.__opn.seen('#mlsOpnTplLib')
    }));
    eq(tplOpen.sel, true, 'the Template disclosure did not reveal the template picker');
    eq(tplOpen.lib, true, 'the Template disclosure carries no way into the template library');
    /* re-opening the SAME patient starts shut again — nothing is remembered */
    await page.evaluate(() => { window.__mlsOpDay.back(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__opn.pressRow(7));
    await page.waitForTimeout(700);
    open7 = await page.evaluate(() => ({
      note: window.__opn.seen('#opPrepNote_7'),
      proc: window.__opn.seen('#opPrepProc_7'),
      tpl: window.__opn.seen('#opPrepTpl_7')
    }));
    eq(open7.note, true, 're-opening the note hid the note text');
    eq(open7.proc, false, 're-opening the note remembered that the raw procedure field was open');
    eq(open7.tpl, false, 're-opening the note remembered that the template picker was open');

    /* the formatted view: it attaches when a note looks structured */
    const fmt = await page.evaluate(async () => {
      const rows = window._opPrep || [];
      const body = ['PROCEDURE PERFORMED:', 'Lumbar medial branch block', '',
        'INDICATIONS:', 'Chronic low back pain.', '',
        'TECHNIQUE:', '- The area was prepped and draped.', '- Fluoroscopic guidance was used.',
        '', 'FINDINGS:', 'Documented.', '', 'DISPOSITION:', 'Stable.'].join('\n');
      rows.forEach((r) => { r.gen = true; r.note = body; });
      opPrepRender();
      await new Promise((r) => setTimeout(r, 1500));
      window.__mlsOpDay.openNote(7);
      await new Promise((r) => setTimeout(r, 900));
      const st = window.__mlsOpDay.status().formatted;
      const wraps = Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt')).filter(window.__opn.visible);
      const bodies = Array.from(document.querySelectorAll('#opPrepModal .mls-fp-fmt .fmt-body')).filter(window.__opn.visible);
      return { st, wraps: wraps.length, bodies: bodies.length };
    });
    ok(fmt.wraps > 0, `no formatted view is on the note surface, so this check proved nothing: ${JSON.stringify(fmt)}`);
    eq(fmt.st.unmarked, 0, `${fmt.st.unmarked} formatted views were never taken in hand`);
    eq(fmt.bodies, 0,
      `${fmt.bodies} formatted-view bodies are on screen before anyone asked for one — it must start hidden every open`);

    /* ================================================================
     * 6. ESC GOES BACK TO THE LIST; THE ARROWS MOVE PATIENTS
     * ============================================================== */
    await page.evaluate(() => { try { document.activeElement.blur(); } catch (e) {} document.body.focus(); });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    eq(await page.evaluate(() => window.__mlsOpDay.selected()), 8,
      'the right-arrow key did not move to the next patient on the note surface');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(600);
    eq(await page.evaluate(() => window.__mlsOpDay.selected()), 7,
      'the left-arrow key did not move back to the previous patient');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const afterEsc = await page.evaluate(() => ({
      open: !!document.getElementById('opPrepModal').classList.contains('show'),
      state: String(document.getElementById('opPrepModal').getAttribute('data-mls-opnotes-state') || '')
    }));
    eq(afterEsc.open, true,
      'Escape on a note surface threw the whole room away instead of going back to the list');
    eq(afterEsc.state, 'list', `Escape on a note surface left the room in state "${afterEsc.state}"`);
    /* and a second Escape leaves the room, as it always has */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    eq(await page.evaluate(() => !!document.getElementById('opPrepModal').classList.contains('show')), false,
      'Escape from the day list no longer closes the room');

    /* ================================================================
     * 7b. THE ROOM ALWAYS OPENS AT ITS OWN TOP
     *
     * Owner report on /cloned: the room's header row sat under the browser
     * chrome. Two things are measured, not one: the surface's top offset (it
     * must never be negative, and never above the room's own box), and — the
     * only honest occlusion test — what document.elementFromPoint returns at
     * the point each of the room's controls would be pressed. A rect is not a
     * click: a control can be perfectly positioned and still sit under a fixed
     * chip that paints over it.
     * ============================================================== */
    {
      const place = async (label) => page.evaluate((tag) => {
        const modal = document.getElementById('opPrepModal');
        const inner = modal && modal.querySelector('.modal');
        const head = ['mlsOpnNote', 'mlsOpDay'].map((id) => document.getElementById(id))
          .filter((e) => e && window.__opn.visible(e))[0] || null;
        const scrollers = [modal, inner, document.getElementById('oprEditor'), document.getElementById('oprPanelProcs')]
          .filter(Boolean).map((n) => Math.round(n.scrollTop));
        const occluded = [];
        if (modal) {
          modal.querySelectorAll('button,input,select,textarea,a[href]').forEach((e) => {
            if (!window.__opn.visible(e)) return;
            const r = e.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2);
            const y = Math.round(r.top + Math.min(r.height / 2, 12));
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
            const hit = document.elementFromPoint(x, y);
            if (!hit || hit === e || e.contains(hit) || hit.contains(e)) return;
            occluded.push({ id: e.id || (e.textContent || '').trim().slice(0, 18) || e.tagName,
              y: Math.round(r.top), under: hit.id || String(hit.className || '').slice(0, 24) || hit.tagName });
          });
        }
        return { tag: tag, headId: head ? head.id : null,
          headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
          modalTop: modal ? Math.round(modal.getBoundingClientRect().top) : null,
          scrollers: scrollers, occluded: occluded };
      }, label);

      /* scroll the room a long way down, then make each transition happen */
      const scrollDown = () => page.evaluate(() => {
        const modal = document.getElementById('opPrepModal');
        const inner = modal.querySelector('.modal');
        [modal, inner, document.getElementById('oprEditor'), document.getElementById('oprPanelProcs')]
          .filter(Boolean).forEach((n) => { n.scrollTop = 900; });
      });

      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1800);
      const onOpen = await place('open');
      await scrollDown();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__opn.pressRow(20));
      await page.waitForTimeout(1000);
      const onNote = await place('note');
      await scrollDown();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__mlsOpDay.back());
      await page.waitForTimeout(900);
      const onBack = await place('back');
      measured.place = [onOpen, onNote, onBack];

      for (const p of [onOpen, onNote, onBack]) {
        ok(p.headId, `the room shows no surface at all after "${p.tag}"`);
        ok(p.headTop >= 0,
          `after "${p.tag}" the room's header row sits at ${p.headTop}px — above the top of the window, i.e. under the browser chrome`);
        ok(p.headTop >= p.modalTop,
          `after "${p.tag}" the room's header row (${p.headTop}px) is above the room's own box (${p.modalTop}px) — it has been scrolled out of its container`);
        assert.deepStrictEqual(p.scrollers.filter((s) => s !== 0), [],
          `after "${p.tag}" the room is still scrolled (${JSON.stringify(p.scrollers)}) — every one of its surfaces is the first thing in the editor, so the room must open at its own top`);
        checks++;
        assert.deepStrictEqual(p.occluded, [],
          `after "${p.tag}" these room controls are painted over by something else: ${JSON.stringify(p.occluded)}`);
        checks++;
      }
    }

    /* ================================================================
     * 7c. AUTOMATIC DRAFTING SPEAKS ON THIS SCREEN, NOT IN A TOAST
     *
     * Owner: the "Drafting the op notes that need one. Stop any time." toast
     * is an OUTCOME of this room, so it belongs in the room's own quiet
     * status line — not floating over the whole app.
     * ============================================================== */
    {
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1500);
      const said = await page.evaluate(async () => {
        /* count real toasts, by watching the app's own toast surface */
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
           is no longer true, and with a stubbed drafter the whole day
           finishes in well under a second. Reading it after the run is
           reading it after it correctly went away. */
        const seen = [];
        for (let k = 0; k < 60; k++) {
          await new Promise((r) => setTimeout(r, 60));
          const n = window.__mlsOpDay.notice();
          if (n) seen.push(n);
        }
        const out = {
          notice: seen[0] || '',
          samples: seen.length,
          after: window.__mlsOpDay.notice(),
          toasts: window.__toasts.slice(),
          status: window.__mlsAutoDraft.status(),
          gen: window.__genCalls
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
      /* and it is not a control — a status line must not add to the budget */
      eq(await page.evaluate(() => {
        const n = document.getElementById('mlsOpnNotice');
        return n ? n.tagName : 'absent';
      }), 'P', 'the quiet run status is a control rather than a line of text');
    }

    /* ================================================================
     * 8. ONE TEMPLATES SURFACE
     * ============================================================== */
    const tpl = await page.evaluate(() => {
      const outside = Array.from(document.querySelectorAll('button[onclick="openTemplates()"]'))
        .filter((b) => !b.closest('#opPrepModal'));
      return {
        outside: outside.length,
        said: outside.filter((b) => /op-note templates/i.test(b.textContent || '') && /in Op Notes/i.test(b.textContent || '')).length,
        labels: outside.map((b) => (b.textContent || '').trim().slice(0, 50))
      };
    });
    ok(tpl.outside > 0, 'there are no Templates buttons outside the room, so this check proved nothing');
    eq(tpl.said, tpl.outside,
      `${tpl.outside - tpl.said} Templates buttons outside the room still do not say they are op-note templates living in Op Notes: ${JSON.stringify(tpl.labels)}`);

    /* ================================================================
     * 9. THE BUDGETS, COUNTED
     * ============================================================== */
    {
      await page.evaluate((d) => window.__opn.open(d), DAY);
      await page.waitForTimeout(1800);
      const list = await page.evaluate(() => window.__opn.chrome());
      measured.budgetList = list;
      ok(list.n <= 7,
        `the day list shows ${list.n} controls that are not a patient row (budget 6, +1 for the retry control a failed run leaves behind): ${JSON.stringify(list.ids)}`);
      eq(list.rows, 24, `the day list shows ${list.rows} of 24 patient rows`);
      await page.evaluate(() => window.__mlsOpDay.openNote(0));
      await page.waitForTimeout(900);
      const note = await page.evaluate(() => window.__opn.chrome());
      measured.budgetNote = note;
      ok(note.n <= 8,
        `the note surface shows ${note.n} controls (budget 8): ${JSON.stringify(note.ids)}`);
      /* and the same at a phone width, without the document scrolling sideways */
      await page.setViewportSize({ width: 360, height: 780 });
      await page.waitForTimeout(600);
      await page.evaluate(() => window.__mlsOpDay.back());
      await page.waitForTimeout(700);
      const narrow = await page.evaluate(() => ({
        chrome: window.__opn.chrome(),
        over: document.documentElement.scrollWidth - innerWidth
      }));
      measured.narrow = narrow;
      ok(narrow.over <= 0, `the op-note room scrolls sideways by ${narrow.over}px at 360`);
      ok(narrow.chrome.n <= 7,
        `the day list at 360 shows ${narrow.chrome.n} controls: ${JSON.stringify(narrow.chrome.ids)}`);
      eq(narrow.chrome.rows, 24, `the day list at 360 shows ${narrow.chrome.rows} of 24 rows`);
      await page.setViewportSize({ width: 1366, height: 900 });

      /* A FOLD THAT CANNOT BE OPENED IS A DELETION. The secondary rail is
         folded in Simple and Normal, and the way back is the app's OWN visible
         control - the mode chip's "Everything" - not a hidden switch. */
      await page.evaluate(() => window.__mlsSimpleLayer.set('guided'));
      await page.waitForTimeout(900);
      const folded = await page.evaluate(() => ({
        rail: window.__opn.seen('#oprDayRail'), chrome: window.__opn.chrome()
      }));
      eq(folded.rail, false, 'the secondary rail is not folded in Simple, so its 40 controls are still on screen');
      await page.evaluate(() => window.__mlsSimpleLayer.set('full'));
      let back = { rail: false, chrome: null };
      for (let settle = 0; settle < 10 && !back.rail; settle++) {
        await page.waitForTimeout(300);
        back = await page.evaluate(() => ({ rail: window.__opn.seen('#oprDayRail'), chrome: window.__opn.chrome() }));
      }
      eq(back.rail, true,
        'switching to Everything did not bring the secondary rail back — the fold is a deletion');
      ok(back.chrome.n > folded.chrome.n,
        `Everything mode shows ${back.chrome.n} controls and Simple shows ${folded.chrome.n} — the fold gives nothing back`);
      measured.everything = back.chrome;
      await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
      await page.waitForTimeout(600);
    }

    eq(pageErrors.length, 0, `the shell threw during the run: ${JSON.stringify(pageErrors.slice(0, 3))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

/* ============================================ PART 3: the causal control ===
 * The same instrument, the same synthetic day, against the shell as it was
 * BEFORE this block existed. Without this, every number above could be an
 * artefact of the harness rather than of the change.
 * ========================================================================= */
async function control() {
  const baselineFile = path.join(os.tmpdir(), 'mls-opnote-list-baseline-' + process.pid + '.html');
  const baseline = execFileSync('git', ['show', PREFIX + ':1pScribeFlow.html'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(baselineFile, baseline);
  ok(String(baseline).indexOf('opnote-day-') < 0,
    'the pinned control commit already carries an opnote-day block — it is not a pre-fix control');

  const { srv, port } = await serve(baselineFile);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  try {
    await bootShell(page, `http://127.0.0.1:${port}/1pScribeFlow.html`);
    await page.evaluate(harness, { DAY, DAY_NEXT });
    await page.evaluate(() => window.__opn.seed());
    await page.evaluate(() => { try { window.__mlsAutoDraft.setEnabled(false); } catch (e) {} });
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));
    await page.evaluate((d) => window.__opn.open(d), DAY);
    await page.waitForTimeout(2500);
    const before = await page.evaluate(() => window.__opn.chrome());
    measured.control = before;
    eq(before.state, '',
      `the pre-fix shell already exposes a room state ("${before.state}") — the control is not a control`);
    eq(before.rows, 0,
      `the pre-fix shell already lists ${before.rows} patients as rows — the control is not a control`);
    ok(before.editors > 1,
      `the pre-fix shell showed ${before.editors} note editors at rest; the defect this block fixes is that it showed one per patient`);
    ok(before.n > (measured.budgetList ? measured.budgetList.n : 99),
      `the pre-fix room showed ${before.n} non-row controls and the rebuilt one shows ${measured.budgetList && measured.budgetList.n} — the change did not reduce the surface`);
    /* the day switcher does not exist there at all */
    const sw = await page.evaluate(() => ['mlsOpnPrevDay', 'mlsOpnNextDay', 'mlsOpnDayIn', 'mlsOpnSearch']
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
    console.log(`1p-opnote-list-first-runtime: ${checks} checks passed`);
    const f = (m) => (m ? `${m.n} controls, ${m.rows} rows, ${m.editors} editors` : 'n/a');
    console.log(`  BEFORE (pre-fix ${PREFIX.slice(0, 8)}) op-note room: ${f(measured.control)}`);
    console.log(`  AFTER  day list                     : ${f(measured.budgetList)}`);
    console.log(`  AFTER  note surface                 : ${f(measured.budgetNote)}`);
    console.log(`  AFTER  day list @360                : ${f(measured.narrow && measured.narrow.chrome)} (overflow ${measured.narrow && measured.narrow.over}px)`);
    console.log(`  AFTER  list controls                : ${JSON.stringify(measured.budgetList && measured.budgetList.ids)}`);
    console.log(`  AFTER  note controls                : ${JSON.stringify(measured.budgetNote && measured.budgetNote.ids)}`);
    console.log(`  AFTER  card height                  : ${measured.cardHeight}`);
    console.log(`  AFTER  header chips                 : ${JSON.stringify(measured.chips)}`);
    console.log(`  AFTER  quiet run status             : ${JSON.stringify(measured.notice)}`);
    (measured.place || []).forEach((p) => {
      console.log(`  AFTER  place @${p.tag.padEnd(5)}              : ${p.headId} top ${p.headTop}px, scrollers ${JSON.stringify(p.scrollers)}, occluded ${p.occluded.length}`);
    });
  })
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
