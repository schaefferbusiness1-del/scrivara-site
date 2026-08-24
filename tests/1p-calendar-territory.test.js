'use strict';

/* /1p CALENDAR + STAFF PREP TERRITORY — "if it's on the program it should work."
 *
 * A press-test of the Calendar screen and the Staff Prep job card, and the pins
 * for the three defects it turned up on 2026-08-18. Everything below is
 * measured on the real shells in real headless Chrome: no login, no network,
 * no PHI, synthetic names only.
 *
 *   1. calfallback-calm-1.0.1  The override that calms the all-providers day
 *      list matched `#mlsFpDayFallback > div[style]` — EVERY child. The box
 *      opens with two children that are not appointments (the "Wednesday,
 *      August 19 — 6 appointments (all providers)" heading and the sentence
 *      explaining why the list is unsplit), so both were painted as
 *      appointment cards with their own brand accent bar, and the heading was
 *      pulled from font-weight 800 down to 600. MEASURED: 6 appointments, 8
 *      matched children.
 *
 *   2. ez3repaint-1.0.0 + staffjobsync-1.0.0  Staff Prep adopts the saved
 *      range job when it MOUNTS and repaints when this tab drives it, but
 *      nothing re-reads the manifest while the panel sits open. MEASURED: a
 *      month job paused at 0 of 18 days left the panel showing only
 *      "▶ Start month pull" and "Nothing pulled yet this session." for 11s
 *      and 299 ticks, while the bar label two lines above already read "0 of
 *      18 days saved". Leaving and returning gave [Resume, Cancel] — the
 *      manifest was right the whole time; only the repaint was missing.
 *      Pressing Start on a merely-paused job is what the durable job exists
 *      to prevent.
 *
 *   3. the article belongs to the phrase  The Staff Prep plain-words pass
 *      rewrote 'saved checkpoint' -> 'the last day it saved', and every
 *      sentence that carries the phrase writes "from THE saved checkpoint" —
 *      so the paused status line read "Resume continues from the the last day
 *      it saved."
 *
 * THE TRAPS THIS SUITE HANDLES, all measured while writing it:
 *   - 1p-mls-connect.js is not loaded by the page on its own; without
 *     __mlsEnsureUiBundle() this measures a bare shell.
 *   - feat_mls_calm_views.js BUILDS the calendar hero and the More
 *     disclosure and is scheduled through requestIdleCallback, which never
 *     fires in a non-compositing tab. Without mounting it explicitly the hero
 *     is absent at four of the five widths and every assertion about it
 *     passes vacuously.
 *   - the day-panel fallback only mounts when the panel is NOT already
 *     showing those patients' names, so a fixture that leaves the day panel
 *     open measures nothing. The panel is closed here on purpose.
 *   - #mlsDock is position:fixed at the bottom, so at phone widths it sits
 *     over the last card until the page is scrolled. body carries 96px of
 *     bottom padding for exactly that; the width sweep scrolls before it
 *     judges reachability, or it would report a defect that is not one.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const MC = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ======================================================== PART 1: static */

for (const rel of SHELLS) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');

  /* --- 1: the calm override addresses the ROWS, not every child --------- */
  const a = src.indexOf('<!-- ===== calfallback-calm-1.0.0');
  const b = src.indexOf('<!-- ===== end calfallback-calm-1.0.0');
  ok(a >= 0 && b > a, `${rel}: the calfallback-calm block is missing or unclosed`);
  const cal = src.slice(a, b);
  ok(!/#mlsFpDayFallback > div\[style\]\s*[{,]/.test(cal),
    `${rel}: the fallback override still matches EVERY child (\`> div[style]\`), so the two heading lines are painted as appointment cards`);
  ok(/#mlsFpDayFallback > div\[style\*="linear-gradient"\]/.test(cal),
    `${rel}: the fallback override no longer targets the gradient rows it exists to overrule`);
  ok(/background-image:\s*none\s*!important/.test(cal),
    `${rel}: the fallback override does not explicitly clear the gradient background-image`);

  /* --- 2: the screen keeps the job card in step, with ONE state machine -- */
  const s = src.indexOf('<!-- ===== staffjobsync-1.0.0');
  const e = src.indexOf('<!-- ===== end staffjobsync-1.0.0');
  ok(s >= 0 && e > s, `${rel}: the staffjobsync-1.0.0 block is missing or unclosed`);
  const sync = src.slice(s, e);
  ok(/__mlsEz3RangeRepaint/.test(sync), `${rel}: staffjobsync does not call the panel's own painter`);
  /* IT MUST NOT DECIDE ANYTHING. A second opinion about which button belongs
     on screen is the defect this suite exists to stop, not the fix. Judged
     over the CODE, not the comment — the block's evidence names the buttons
     it measured, and that is the record, not a rule being broken. */
  const syncCode = sync.slice(sync.indexOf('<script>'));
  ok(syncCode.length > 200, `${rel}: the staffjobsync block has no script to judge`);
  for (const id of ['ez3PullStart', 'ez3PullResume', 'ez3PullPause', 'ez3PullRetry', 'ez3PullCancel']) {
    ok(syncCode.indexOf(id) < 0, `${rel}: staffjobsync's code names ${id} — it has become a second state machine`);
  }
  ok(/setInterval\(tick,/.test(syncCode), `${rel}: staffjobsync has no tick, so nothing re-reads the manifest`);
  ok(!/requestAnimationFrame|requestIdleCallback/.test(syncCode),
    `${rel}: staffjobsync schedules on rAF/rIC, which never fire in a hidden tab — the exact case it exists for`);
  ok(/if \(s === last\) return false;/.test(syncCode),
    `${rel}: staffjobsync repaints on every tick instead of only on a change`);

  /* --- 3: the article is part of the phrase being replaced -------------- */
  ok(src.indexOf("['the saved checkpoint', 'the last day it saved']") > 0,
    `${rel}: the plain-words pair does not carry the article, so it produces "from the the last day it saved"`);
  eq(src.split("['saved checkpoint', 'the last day it saved']").length - 1, 0,
    `${rel}: the article-less pair is still present`);

  /* the twins carry identical blocks */
  if (rel !== SHELLS[0]) {
    const first = fs.readFileSync(path.join(root, SHELLS[0]), 'utf8');
    const cut = (t, name) => t.slice(t.indexOf('<!-- ===== ' + name), t.indexOf('<!-- ===== end ' + name));
    for (const name of ['calfallback-calm-1.0.0', 'staffjobsync-1.0.0']) {
      eq(cut(src, name), cut(first, name), `the two shells carry different ${name} blocks`);
    }
  }
}

/* a check that finishes says what it found */
{
  const a = MC.indexOf('/* ===== apicheck-says-1.0.0');
  const b = MC.indexOf('/* ===== end apicheck-says-1.0.0');
  ok(a >= 0 && b > a, '1p-mls-connect.js: the apicheck-says-1.0.0 block is missing or unclosed');
  const block = MC.slice(a, b);
  /* THE DEFECT WAS THE SUCCESS BRANCH, not the failure one: it cleared the
     note, and updateAthenaStatus RESOLVES on failure too. */
  ok(!/then\(function \(\) \{ athenaApiPrepNote = ''; render\(\); \}/.test(block),
    'the Athena check still clears its own note when it finishes, so it reports nothing');
  ok(/st\.connected/.test(block), 'the Athena check does not read the state it was handed');
  ok(/Not connected — /.test(block), 'the Athena check has no wording for a check that came back negative');
}

/* the painter is published, and it adopts before it paints */
{
  const a = MC.indexOf('/* ===== ez3repaint-1.0.0');
  const b = MC.indexOf('/* ===== end ez3repaint-1.0.0');
  ok(a >= 0 && b > a, '1p-mls-connect.js: the ez3repaint-1.0.0 block is missing or unclosed');
  const block = MC.slice(a, b);
  ok(/window\.__mlsEz3RangeRepaint = function/.test(block), 'the panel painter is not published');
  /* pCounts opens with `if (!P) return;`, so the whole durable-control branch
     is unreachable until a job is adopted into this tab. */
  ok(/if \(!P\) \{ p1RangeAdopt\(\); adopted = !!P; \}/.test(block),
    'the published painter does not adopt the saved job first, so pCounts returns before it reaches the controls');
  ok(/p1RangePaint\(\)/.test(block), 'the published painter does not call p1RangePaint');
  ok(/'Nothing pulled yet this session\.'/.test(block),
    'the painter does not clear the no-job sentence after adopting a job');
  /* pCounts must still be the only place that decides visibility */
  ok(MC.indexOf("var btnU = $('ez3PullResume');") > 0, 'the control rule moved out of pCounts');
}

/* ==================================================== PART 2: runtime */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected. Synthetic names only. */
function harness() {
  var PROCS = ['Lumbar medial branch block', 'Right L4-L5 transforaminal epidural steroid injection',
    'Radiofrequency ablation, lumbar facet', 'Sacroiliac joint injection'];
  function inClosedDetails(el) {
    for (var n = el; n; n = n.parentElement) {
      if (n.tagName === 'DETAILS' && !n.open) return true;
      if (n.tagName === 'SUMMARY') return false;
    }
    return false;
  }
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (inClosedDetails(el)) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return false;
    for (var n = el; n; n = n.parentElement) {
      var c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden') return false;
    }
    return true;
  }
  window.__cal = {
    visible: visible,
    shown: function (s) { var e = document.querySelector(s); return !!(e && visible(e)); },
    nav: function (id) { try { var b = document.getElementById(id); if (b) b.click(); } catch (e) {} },
    /* THE REAL DATA SOURCE. loadCalendar() writes "Sign in to see the
       calendar." and RETURNS on a signed-out hosted session, so a seed applied
       before navigating is overwritten. Give it a token, answer
       /api/appointments, and `_calAppts = d.appointments` is the authority. A
       month must also be SPREAD: 28 appointments on one day are five chips and
       a "+23 more". */
    seedMonth: function () {
      var FIRST = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max',
        'Nia', 'Oz', 'Pia', 'Quin', 'Rae', 'Sid', 'Tex', 'Uma', 'Val', 'Wes', 'Xan', 'Yas', 'Zed', 'Ann', 'Ben'];
      var LAST = ['Sample', 'Synthetic', 'Placeholder', 'Testcase'];
      var STATUS = ['booked', 'arrived', 'roomed', 'completed'];
      var rows = [], id = 9000, n = 0;
      for (var d = 1; d <= 31; d++) {
        var dow = new Date(2026, 7, d).getDay();
        if (dow === 0 || dow === 6) continue;
        for (var k = 0; k < 6; k++) {
          var hh = 8 + k, half = (n % 2) ? '30' : '00';
          var key = '2026-08-' + (d < 10 ? '0' + d : String(d));
          var hs = (hh < 10 ? '0' + hh : String(hh));
          rows.push({ id: ++id,
            name: FIRST[n % FIRST.length] + ' ' + LAST[Math.floor(n / FIRST.length) % LAST.length],
            patient_external_id: String(900000 + (n % 60)),
            appt_date: key, start_at: key + 'T' + hs + ':' + half + ':00',
            end_at: key + 'T' + hs + ':' + (half === '30' ? '55' : '25') + ':00',
            reason: PROCS[n % PROCS.length], status: STATUS[n % STATUS.length],
            provider: 'Sample Provider, MD', room: 'R' + (n % 4) });
          n++;
        }
      }
      try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
      if (!window.__calFetch) {
        var of = window.fetch.bind(window);
        window.fetch = function (u, o) {
          var s = String((u && u.url) || u || '');
          if (/\/api\/appointments(\?|$)/.test(s)) {
            return Promise.resolve(new Response(JSON.stringify({ appointments: window.__calRows, me: {} }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          if (/\/api\/providers/.test(s)) {
            return Promise.resolve(new Response(JSON.stringify({ providers: [] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return of(u, o);
        };
        window.__calFetch = true;
      }
      window.__calRows = rows;
      window._calMode = 'month'; window._calYear = 2026; window._calMonth = 7;
      window._calRefDate = '2026-08-17';
      var g = document.getElementById('calGrid'); if (g) { try { g._mlsSig = null; } catch (e) {} }
      return window.loadCalendar().then(function (r) { return { applied: !!(r && r.applied), count: r ? r.count : 0 }; });
    }
  };
}

async function boot(page, port, shell) {
  await page.goto(`http://127.0.0.1:${port}/${(shell || '1pScribeFlow.html').replace(/\\/g, '/')}`,
    { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
  });
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test'; });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { try { if (window.__mlsCalmShell && window.__mlsCalmShell.boot) window.__mlsCalmShell.boot(); } catch (e) {} });
  await page.waitForTimeout(1500);
  /* the module that BUILDS the hero and the More disclosure */
  await page.evaluate(() => {
    ['feat_mls_calm_views.js', 'feat_mls_datalink_exact.js'].forEach((a) => {
      if (document.querySelector('script[data-mls-asset="' + a + '"]')) return;
      const s = document.createElement('script');
      s.src = a + '?v=' + (window.__MLS_AV || Date.now());
      s.setAttribute('data-mls-asset', a);
      s.async = false;
      document.body.appendChild(s);
    });
  });
  await page.waitForTimeout(3000);
  await page.evaluate(harness);
}

async function openStaff(page) {
  await page.evaluate(() => window.__cal.nav('nav_visit'));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mls:menu-staff-prep-request',
    { detail: { source: 'mls-topbar-menu', requestId: '1p-calendar-territory' } })));
  await page.waitForTimeout(2400);
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await boot(page, port);
    const seeded = await page.evaluate(() => window.__cal.seedMonth());
    eq(seeded.applied, true, 'the synthetic month did not load through loadCalendar()');
    eq(seeded.count, 126, `the synthetic month seeded ${seeded.count} appointments, not 126`);

    /* ============================================ CALENDAR CONTROLS ==== */
    await page.evaluate(() => window.__cal.nav('nav_calendar'));
    await page.waitForTimeout(2200);

    const disclosure = await page.evaluate(async () => {
      const before = Array.prototype.slice.call(document.querySelectorAll('#calendarView button, #calendarView input, #calendarView select'))
        .filter(window.__cal.visible).map((n) => n.id || (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24));
      const b = document.getElementById('mlsCvMore_calendar');
      if (!b) return { there: false };
      b.click();
      await new Promise((r) => setTimeout(r, 900));
      const after = Array.prototype.slice.call(document.querySelectorAll('#calendarView button, #calendarView input, #calendarView select'))
        .filter(window.__cal.visible).map((n) => n.id || (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24));
      return { there: true, before, after, expanded: b.getAttribute('aria-expanded'), label: b.textContent };
    });
    ok(disclosure.there, 'the calendar More disclosure is not on screen, so its folded tools are unreachable');
    eq(disclosure.expanded, 'true', 'the calendar More disclosure did not report itself open after a press');
    ok(disclosure.after.length > disclosure.before.length,
      `pressing "${disclosure.label}" revealed nothing: ${disclosure.before.length} controls before, ${disclosure.after.length} after`);
    measured.calMore = { before: disclosure.before.length, after: disclosure.after.length };
    /* the tools it exists to hold */
    for (const want of ['calNewAppt', 'loadCalendar', 'calWorkingHours', 'cleanupDuplicateAppointments']) {
      const found = await page.evaluate((fn) => Array.prototype.slice.call(document.querySelectorAll('#calendarView [onclick]'))
        .filter(window.__cal.visible).some((n) => (n.getAttribute('onclick') || '').indexOf(fn) >= 0), want);
      ok(found, `the calendar tools fold does not contain ${want}() — a control the screen still names`);
    }

    /* EVERY visible calendar control answers a press. A control that changes
       nothing, says nothing and throws nothing is the thing the new rule
       forbids. Grid chips and day cells are excluded: they are data, and they
       are covered by the day-panel assertions below. */
    const presses = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const V = document.getElementById('calendarView');
      const nodes = Array.prototype.slice.call(V.querySelectorAll('button,[onclick]'))
        .filter(window.__cal.visible)
        .filter((n) => !/calApptPeek|calOpenDay/.test(n.getAttribute('onclick') || ''))
        .filter((n) => n.id !== 'mlsCvMore_calendar');
      const out = [];
      for (const n of nodes) {
        const id = n.id || (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 26);
        /* Visibility is judged AT PRESS TIME, not at capture (moved 2026-08-19,
           measured: pressing ◀/Today closes the day panel, so its "✕ Close"
           was pressed while hidden and read as dead — panelBefore="none" on
           the instrumented run. The rule this suite states is that every
           VISIBLE control answers; a control whose surface has legitimately
           left the stage is skipped and recorded, never counted dead. */
        if (!window.__cal.visible(n)) { out.push({ id, hiddenAtPress: 1, d: 1, err: '', disabled: false }); continue; }
        /* Compare the markup ITSELF, not its length. A length delta calls a
           press silent whenever the page happens to shrink somewhere else by
           as much as it grew — measured: "✕ Close" hides the day panel, and a
           concurrent repaint made the two cancel out exactly. */
        const before = document.body.innerHTML;
        let err = '';
        try { n.click(); } catch (e) { err = String(e.message); }
        await sleep(420);
        out.push({ id, d: document.body.innerHTML !== before ? 1 : 0, err,
          disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true' });
        try { document.querySelectorAll('.modal-bg.show').forEach((m) => m.classList.remove('show')); } catch (e) {}
        try { const p = document.getElementById('calApptPeek'); if (p) p.remove(); } catch (e) {}
        await sleep(150);
      }
      return out;
    });
    measured.calPresses = presses.length;
    ok(presses.length >= 10, `only ${presses.length} calendar controls were pressed — the fold did not open`);
    for (const p of presses) {
      eq(p.err, '', `pressing ${p.id} threw: ${p.err}`);
      ok(p.disabled || p.d > 0, `${p.id} is on the Calendar screen, is not disabled, and pressing it changes nothing`);
    }

    /* the appointment chips open the peek card, and it carries its actions */
    const peek = await page.evaluate(async () => {
      try { window.calSetMode('month'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 900));
      try { window.calApptPeek(9073, null); } catch (e) { return { err: String(e.message) }; }
      await new Promise((r) => setTimeout(r, 600));
      const p = document.getElementById('calApptPeek');
      return { there: !!(p && window.__cal.visible(p)),
        buttons: p ? Array.prototype.slice.call(p.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) : [] };
    });
    ok(peek.there, 'clicking an appointment chip opens nothing');
    ok(peek.buttons.length >= 3, `the appointment card offers ${peek.buttons.length} actions: ${peek.buttons.join(', ')}`);
    measured.peek = peek.buttons.join(' | ');

    /* the day panel lists the day and offers its own add row */
    const day = await page.evaluate(async () => {
      const p = document.getElementById('calApptPeek'); if (p) p.remove();
      try { window.calOpenDay('2026-08-19'); } catch (e) { return { err: String(e.message) }; }
      await new Promise((r) => setTimeout(r, 900));
      const panel = document.getElementById('calDayPanel');
      return { shown: window.__cal.shown('#calDayPanel'),
        rows: panel ? panel.querySelectorAll('[onclick*="calApptInfo"]').length : 0,
        add: !!(panel && panel.querySelector('[onclick*="calAddAppt"]')),
        close: !!(panel && panel.querySelector('[onclick*="calDayPanel"]')) };
    });
    ok(day.shown, 'clicking a day opens no day panel');
    eq(day.rows, 6, `the day panel listed ${day.rows} of the 6 seeded appointments`);
    ok(day.add, 'the day panel has no way to add an appointment');
    ok(day.close, 'the day panel has no way to close it');

    /* =================================== 1: THE DAY-PANEL FALLBACK ===== */
    const fb = await page.evaluate(async () => {
      /* The fallback stays out of the way when the panel already shows these
         names, and it decides that by reading textContent — which does NOT
         care about display:none, and the panel lives INSIDE #calendarView, so
         hiding it is not enough: the closed panel's leftover rows still read
         as "the screen is already showing them" and the fallback never
         mounts. (Measured: that is exactly why the first version of this
         fixture found nothing.) Empty it as well, which is the live shape —
         the month grid abbreviates to "Quin P." and never carries the
         surname the fallback looks for. */
      const p = document.getElementById('calDayPanel');
      if (p) { p.innerHTML = ''; p.style.display = 'none'; }
      window._calRefDate = '2026-08-19';
      const fp = window.__mlsFixpack;
      if (!fp || !fp.installed) return { fixpack: false };
      (fp._refreshers || []).forEach((f) => { try { f(document, 'calendar'); } catch (e) {} });
      await new Promise((r) => setTimeout(r, 800));
      const box = document.getElementById('mlsFpDayFallback');
      if (!box) return { fixpack: true, mounted: false };
      const kids = Array.prototype.slice.call(box.children).filter((n) => n.tagName === 'DIV' && n.getAttribute('style'));
      const rows = kids.filter((n) => /linear-gradient/.test(n.getAttribute('style') || ''));
      const heads = kids.filter((n) => !/linear-gradient/.test(n.getAttribute('style') || ''));
      const look = (n) => { const s = getComputedStyle(n); return { bg: s.backgroundColor, img: s.backgroundImage,
        color: s.color, fw: s.fontWeight, blw: s.borderLeftWidth }; };
      return { fixpack: true, mounted: true, kids: kids.length, rows: rows.length, heads: heads.length,
        row: rows.length ? look(rows[0]) : null,
        head: heads.length ? look(heads[0]) : null,
        headText: heads.length ? (heads[0].textContent || '').slice(0, 60) : '',
        /* nothing anywhere in the box is still a dark slab */
        gradients: Array.prototype.slice.call(box.querySelectorAll('*'))
          .filter((n) => /gradient/.test(getComputedStyle(n).backgroundImage)).length };
    });
    ok(fb.fixpack, 'the fixpack that owns the day-panel fallback is not installed, so nothing below was measured');
    ok(fb.mounted, 'the day-panel fallback did not mount, so the calm override is unmeasured');
    eq(fb.rows, 6, `the fallback listed ${fb.rows} of the 6 appointments`);
    eq(fb.heads, 2, `the fallback opened with ${fb.heads} heading lines, not 2`);
    eq(fb.gradients, 0, 'the fallback still paints a gradient somewhere — the wall of dark banners is back');
    /* the rows are calm */
    eq(fb.row.img, 'none', `an appointment row still carries a background image: ${fb.row.img}`);
    eq(fb.row.bg, 'rgb(255, 255, 255)', `an appointment row is not a white card: ${fb.row.bg}`);
    eq(fb.row.blw, '3px', `an appointment row lost its thin brand accent (border-left ${fb.row.blw})`);
    ok(fb.row.color !== 'rgb(255, 255, 255)', 'an appointment row still prints white text');
    /* and the headings are NOT rows */
    eq(fb.head.blw, '0px', `the heading "${fb.headText}" is painted as an appointment card (border-left ${fb.head.blw})`);
    eq(fb.head.fw, '800', `the heading "${fb.headText}" lost its weight (font-weight ${fb.head.fw})`);
    measured.fallback = { rows: fb.rows, heads: fb.heads, rowBg: fb.row.bg, headFw: fb.head.fw };

    /* ============================ 2 + 3: STAFF PREP JOB CARD =========== */
    await openStaff(page);
    const onStaff = await page.evaluate(() => !!document.querySelector('.ez3-pull'));
    ok(onStaff, 'Staff Prep did not open, so nothing below was measured');

    /* CLUNKY 84's budget still holds after everything above */
    const pulls = await page.evaluate(() => Array.prototype.slice.call(document.querySelectorAll('#mlsEz3 button, #mlsEz3 a[href]'))
      .filter(window.__cal.visible).filter((b) => /\bpull\b/i.test(b.textContent || ''))
      .map((b) => b.id || (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26)));
    measured.waysToPull = pulls.join(' | ');
    ok(pulls.length <= 4, `${pulls.length} ways to pull on the Staff Prep screen: ${pulls.join(', ')}`);

    /* the Athena check reports its verdict instead of erasing it */
    const apiCheck = await page.evaluate(async () => {
      const line = () => String((document.getElementById('ez3sAthenaApiStatus') || {}).textContent || '');
      const before = line();
      const b = document.getElementById('ez3sAthenaApiCheck');
      if (!b) return { missing: true };
      b.click();
      await new Promise((r) => setTimeout(r, 2500));
      return { before, after: line() };
    });
    ok(!apiCheck.missing, 'the Athena API check button is not on the Staff Prep screen');
    measured.apiCheck = apiCheck;
    ok(apiCheck.after !== apiCheck.before,
      `"Check Athena API connection" finished and left the line reading exactly what it read before: "${apiCheck.after}"`);
    ok(/connected/i.test(apiCheck.after),
      `the Athena check's verdict does not say whether it is connected: "${apiCheck.after}"`);
    ok(!/^Selected range:/.test(apiCheck.after),
      `the Athena check fell back to the idle "Selected range" line: "${apiCheck.after}"`);
    /* the server's error text does not have to end a sentence, and "Failed to
       fetch MLS Assist is unaffected" is what happens when nobody adds one */
    ok(!/[a-z] MLS Assist is unaffected/.test(apiCheck.after),
      `the verdict runs two sentences together: "${apiCheck.after}"`);

    const engine = await page.evaluate(() => !!(window.__mlsP1RangeJobs && window.__mlsP1RangeJobs.installed));
    ok(engine, 'the durable range engine is not installed, so the job-card assertions would be vacuous');

    const read = () => page.evaluate(() => {
      const st = window.__mlsP1RangeJobs.state();
      const on = (id) => { const n = document.getElementById(id); return !!(n && window.__cal.visible(n)); };
      return { status: st && st.status,
        start: on('ez3PullStart'), resume: on('ez3PullResume'), pause: on('ez3PullPause'),
        retry: on('ez3PullRetry'), cancel: on('ez3PullCancel'),
        now: String((document.getElementById('ez3PullNow') || {}).textContent || ''),
        repaints: window.__mlsStaffJobSync ? window.__mlsStaffJobSync.repaints() : -1 };
    });

    const idle = await read();
    ok(idle.start, 'Staff Prep offers no Start at idle');
    ok(!idle.resume && !idle.pause && !idle.retry && !idle.cancel,
      'Staff Prep offers a job control at idle, with no job to act on');

    /* the state changes OUT OF BAND — another tab, a boot resume, a session
       boundary. This is the case the panel could not see. */
    /* This fixture measures the out-of-band job-card repaint, not the
       first-use Full Notes question. Freeze the synthetic job OFF so the
       production admission gate cannot leave headless Chrome waiting for a
       human choice that this probe intentionally does not exercise. */
    await page.evaluate(() => window.__mlsP1RangeJobs.startMonth('2026-08', {
      provider: 'all', pullVisitBodies: false, fullNotes: false
    }));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__mlsP1RangeJobs.pause());
    await page.waitForTimeout(2500);
    const paused = await read();
    measured.pausedCard = paused;
    eq(paused.status, 'paused', `the job did not pause (status ${paused.status})`);
    ok(paused.resume,
      'a month job is PAUSED with Staff Prep on screen and the panel offers no Resume — the doctor is left with Start, which is what the durable job exists to prevent');
    ok(paused.cancel, 'a paused month job offers no way to cancel it');
    ok(!paused.start, 'a paused month job still offers "Start month pull", which would begin a second one');
    eq(paused.now, '', `the panel still says "${paused.now}" above a Resume button for a job with saved days`);
    ok(paused.repaints > 0, 'staffjobsync never repainted, so the controls above were correct by accident');

    /* and it must SETTLE, not oscillate: no repaint while nothing changes */
    const settleA = await page.evaluate(() => window.__mlsStaffJobSync.repaints());
    await page.waitForTimeout(3000);
    const settleB = await page.evaluate(() => window.__mlsStaffJobSync.repaints());
    eq(settleB, settleA, `staffjobsync repainted ${settleB - settleA} times in 3s with nothing changing — the tick is writing, not reading`);

    /* 3: the plain-words pass no longer doubles the article */
    const words = await page.evaluate(() => {
      const t = String((document.getElementById('mlsP1YearStatus') || {}).textContent || '') + ' ' +
        String((document.getElementById('mlsEz3') || document.body).innerText || '');
      return { doubles: (t.match(/\b(\w+) \1\b/gi) || []).filter((m) => !/^(had had|that that)$/i.test(m)),
        chk: t.indexOf('saved checkpoint') >= 0,
        resume: /Resume continues from the last day it saved\./.test(t) };
    });
    eq(words.doubles.length, 0, `Staff Prep prints a doubled word: ${words.doubles.join(', ')}`);
    eq(words.chk, false, 'the plain-words pass left "saved checkpoint" untranslated somewhere');
    ok(words.resume, 'the paused sentence is no longer the calm one-article wording');

    ok(pageErrors.length === 0, 'the page threw during the run: ' + pageErrors.join(' | '));
    await page.close();

    /* ===== THE DAY THE DOCTOR CLICKS, ON A CLEAN SCREEN =================
       Its own page on purpose: the press-test above deliberately presses
       every control, and one of them leaves #mlsCompBody over the grid — so
       measuring the day cell on that page hit an overlay, not the calendar.
       (Measured: elementFromPoint returned mlsCompBody at every point in the
       cell.) A defect probe must not inherit the debris of another probe. */
    const dp = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    dp.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(dp, port);
    await dp.evaluate(() => window.__cal.seedMonth());
    await dp.evaluate(() => window.__cal.nav('nav_calendar'));
    await dp.waitForTimeout(1200);
    /* == THE DAY THE DOCTOR CLICKS SURVIVES A REAL POST-PULL FOCUS ==
     * A plain loadCalendar refresh no longer masquerades as a pull. Exercise
     * the genuine post-pull focus explicitly after the click below.
     * caldaysel-1.0.0's capture-phase
     * onNavClick is what stops it: a click on a control whose own onclick
     * names calOpenDay stamps window.__mlsCalUserDayAt, which focusCalDay
     * already honours for five minutes.
     *
     * THE INSTRUMENT LIES FIRST, and it lied here: calling calOpenDay()
     * programmatically fires no click, so onNavClick never runs, the stamp is
     * never set, and the selection IS dragged back — measured at 4 of 6
     * delays. That is the probe, not the product. This clicks the cell the way
     * a doctor does, at +1400ms, inside the window between the two passes. */
    await dp.evaluate(() => {
      const q = document.getElementById('calApptPeek'); if (q) q.remove();
      const p = document.getElementById('calDayPanel'); if (p) { p.innerHTML = ''; p.style.display = 'none'; }
      window._calSelDay = ''; window.__mlsCalUserDayAt = 0;
      try { window.calSetMode('month'); } catch (e) {}
      const cell = Array.prototype.slice.call(document.querySelectorAll('#calGrid [onclick]'))
        .find((n) => /calOpenDay\('2026-08-21'\)/.test(n.getAttribute('onclick') || ''));
      if (cell) cell.scrollIntoView({ block: 'center' });
    });
    await dp.waitForTimeout(400);
    const pin = await dp.evaluate(() => {
      const cell = Array.prototype.slice.call(document.querySelectorAll('#calGrid [onclick]'))
        .find((n) => /calOpenDay\('2026-08-21'\)/.test(n.getAttribute('onclick') || ''));
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      /* RECT COORDINATES ARE NOT CLICK COORDINATES. A sticky header can sit
         over the top of the cell, and its own appointment chips carry
         calApptPeek — clicking one of those opens the peek and stamps
         nothing. Walk the cell for a point that really resolves to the DAY
         control, and fail loudly if there is none rather than click blind. */
      const want = (n) => { const o = n && n.closest && n.closest('[onclick]'); return !!(o && /calOpenDay\('2026-08-21'\)/.test(o.getAttribute('onclick') || '')); };
      const tried = [];
      for (let fy = 0.12; fy <= 0.95; fy += 0.11) {
        for (const fx of [0.5, 0.2, 0.8]) {
          const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy);
          if (y <= 0 || y >= window.innerHeight) continue;
          const top = document.elementFromPoint(x, y);
          if (want(top)) return { x, y, h: Math.round(r.height), hits: true, tried: tried.length };
          tried.push((top ? (top.id || top.tagName) : 'null') + '@' + x + ',' + y);
        }
      }
      return { h: Math.round(r.height), hits: false, tried: tried.slice(0, 6).join(' ') };
    });
    ok(pin && pin.h > 0, 'the Aug 21 day cell could not be found, so the day pin is unmeasured');
    ok(pin.hits, `no point inside the Aug 21 cell resolves to its own day control (tried ${pin.tried}) — the measurement would be meaningless`);
    await dp.mouse.click(pin.x, pin.y);
    await dp.evaluate(() => window.__mlsLink.syncAll('pull', true));
    await dp.waitForTimeout(1800);
    const pinned = await dp.evaluate(() => ({
      sel: window._calSelDay, ref: window._calRefDate,
      stamped: !!window.__mlsCalUserDayAt,
      hero: String((document.getElementById('mlsCvNxt_calendar') || {}).innerText || '').split('\n')[0],
      panel: String((document.querySelector('#calDayPanel div') || {}).textContent || '').slice(0, 34)
    }));
    measured.dayPin = pinned;
    ok(pinned.stamped, 'clicking a day did not stamp __mlsCalUserDayAt, so the automatic jump has no brake');
    eq(pinned.sel, '2026-08-21', `the day the doctor clicked was dragged to ${pinned.sel} four seconds later`);
    eq(pinned.ref, '2026-08-21', `the pull target was dragged to ${pinned.ref} four seconds later`);
    ok(/Aug 21/.test(pinned.hero), `the hero offers "${pinned.hero}" over a day panel the doctor opened on Aug 21`);
    ok(/August 21/.test(pinned.panel), `the day panel reads "${pinned.panel}" after a click on Aug 21`);


    await dp.close();

    /* ====================================== FIVE WIDTHS ================ */
    for (const [w, h] of [[360, 780], [390, 844], [768, 1024], [1280, 800], [1440, 900]]) {
      const p = await browser.newPage({ viewport: { width: w, height: h } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
      await boot(p, port, '1pScribeFlow.html');
      await p.evaluate(() => window.__cal.seedMonth());
      await p.evaluate(() => window.__cal.nav('nav_calendar'));
      await p.waitForTimeout(2000);
      const r = await p.evaluate((vw) => {
        const sc = document.scrollingElement || document.documentElement;
        const idOf = (n) => n.id || (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 22) || n.tagName;
        /* The CHROME of the screen — hero, fold, month/week/day, the tools.
           The month grid's day cells are data, and they scroll under the
           sticky header and over the fixed dock by design; judging them as
           "unreachable" reports a defect that is not one. */
        const chrome = () => Array.prototype.slice.call(
          document.getElementById('calendarView').querySelectorAll('button,select,input,[onclick]'))
          .filter(window.__cal.visible)
          .filter((n) => !n.closest('#calGrid'));
        const uncovered = (n) => {
          const b = n.getBoundingClientRect();
          const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
          if (cy <= 0 || cy >= window.innerHeight) return false;
          const top = document.elementFromPoint(cx, cy);
          return !!(top && (top === n || n.contains(top) || top.contains(n)));
        };
        /* Reachable means reachable AT SOME SCROLL POSITION. #mlsRdTop is
           sticky at the top and #mlsDock is fixed at the bottom (body carries
           96px of padding for it), so ONE snapshot condemns whatever happens
           to be under either of them at that instant — and on a 780px phone
           most of a long day panel is simply not in the viewport at all. The
           page is walked top to bottom and a control passes if any position
           can press it. */
        const seen = new Map();
        const sample = () => chrome().forEach((n) => {
          const okNow = uncovered(n);
          if (!seen.has(n)) seen.set(n, { id: idOf(n), ok: false, why: '' });
          const rec = seen.get(n);
          if (okNow) { rec.ok = true; return; }
          const b = n.getBoundingClientRect();
          const cy = b.top + b.height / 2;
          if (cy <= 0 || cy >= window.innerHeight) return;   /* not at this position; try another */
          const top = document.elementFromPoint(b.left + b.width / 2, cy);
          rec.why = top ? (top.id || top.tagName) : 'nothing';
        });
        const steps = [0, 0.25, 0.5, 0.75, 1];
        return new Promise((res) => {
          let i = 0;
          const step = () => {
            if (i >= steps.length) {
              const V = document.getElementById('calendarView');
              const ctl = Array.prototype.slice.call(V.querySelectorAll('button,select,input,[onclick]')).filter(window.__cal.visible);
              const off = [], clip = [];
              ctl.forEach((n) => {
                const b = n.getBoundingClientRect();
                if (b.right > vw + 1 || b.left < -1) off.push(idOf(n));
                if (n.children.length === 0 && n.scrollWidth > n.clientWidth + 1) clip.push(idOf(n));
              });
              const cov = [], never = [];
              seen.forEach((rec) => {
                if (rec.ok) return;
                (rec.why ? cov : never).push(rec.id + (rec.why ? ' <- ' + rec.why : ''));
              });
              res({ n: ctl.length, chrome: seen.size, off, clip, cov, never,
                docW: document.documentElement.scrollWidth,
                hero: !!document.getElementById('mlsCvNxt_calendar'),
                more: !!document.getElementById('mlsCvMore_calendar') });
              return;
            }
            sc.scrollTop = Math.round((sc.scrollHeight - window.innerHeight) * steps[i++]);
            setTimeout(() => { sample(); step(); }, 380);
          };
          step();
        });
      }, w);
      measured['w' + w] = { controls: r.n, chrome: r.chrome, docW: r.docW, hero: r.hero };
      ok(r.chrome >= 5, `${w}x${h}: only ${r.chrome} chrome controls were judged — the screen did not render`);
      ok(r.hero, `${w}x${h}: the calendar hero is not built, so the primary action is missing`);
      ok(r.more, `${w}x${h}: the calendar More disclosure is missing, so its tools are unreachable`);
      ok(r.docW <= w + 1, `${w}x${h}: the page scrolls sideways (document width ${r.docW})`);
      eq(r.off.length, 0, `${w}x${h}: controls off screen: ${r.off.join(', ')}`);
      eq(r.clip.length, 0, `${w}x${h}: controls with clipped labels: ${r.clip.join(', ')}`);
      eq(r.cov.length, 0, `${w}x${h}: controls something is sitting on top of, at every scroll position: ${r.cov.join(', ')}`);
      eq(r.never.length, 0, `${w}x${h}: controls that never enter the viewport at any scroll position: ${r.never.join(', ')}`);
      eq(errs.length, 0, `${w}x${h}: the page threw: ${errs.join(' | ')}`);
      await p.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED');
  for (const k of Object.keys(measured)) console.log('  ' + k + ': ' + JSON.stringify(measured[k]));
  console.log(`1p-calendar-territory: ${checks} checks passed`);
}, (err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
