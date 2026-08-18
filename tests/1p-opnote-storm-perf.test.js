'use strict';

/* /1p OP NOTES — THE ROOM UNDER A STORM OF CLICKS
 *
 * Owner, 2026-08-18: "in the op notes when clicking around fast when drafting,
 * things get clunky and slow — the exact thing we are trying to fix. I do like
 * the NEW op notes UI, it just needs the tweaks."
 *
 * So the room is stormed the way he uses it: a draft-all is RUNNING (the
 * generator is stubbed so it completes offline) and the doctor switches patient
 * ten times while it does. Per switch this records the synchronous click
 * handler cost, the mutation burst inside #opPrepModal, and how long the room
 * takes to go quiet again. Long tasks over 50 ms are collected for the storm.
 *
 * THE MEASUREMENT THAT MATTERS MOST IS THE LAST ONE. Before opnote-day-4.0.1,
 * MEASURED on a 17-patient day: 17 of 17 rail rows were destroyed and rebuilt
 * on EVERY switch — 0 of the original nodes survived the storm — because the
 * rebuild guard was the whole paint signature and the paint signature includes
 * the selection. Choosing a patient changes which row is MARKED; it changes
 * nothing about any row's name, procedure or status. A row rebuild also throws
 * away the rail's scroll position, its focus and its :hover, so this is not
 * only a cost, it is three small correctness bugs wearing one mask.
 *
 * THE FIRST SWITCH IS NOT BUDGETED AND THAT IS DELIBERATE: it lands inside the
 * burst that STARTING a draft-all causes, which is the runner's work and not
 * the room's render path. It is reported so the number is visible, and the
 * budget is applied to the steady state — the nine switches after it — which
 * is what "clicking around fast" actually is.
 *
 * SCOPE. This suite measures THE ROOM'S OWN RENDER PATH. The .opr-tplmode
 * write-rate guard belongs to the residue lane and is deliberately not
 * duplicated here.
 *
 * rAF is never used: it does not fire in a non-compositing tab, so every
 * settle below is a setTimeout poll for "no mutation for 200 ms".
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const DAY = '2026-08-17';
const N_PATIENTS = 17;
const SWITCHES = 10;

/* Budgets. Generous against the measured numbers on this box, because a
   wall-clock bar measured on a shared CPU is a flake generator — these are set
   to catch a REGRESSION of the kind above, not to police jitter. */
const MAX_HANDLER_MS = 100;
const MAX_STEADY_BURST = 200;
const MAX_STEADY_STABLE_MS = 300;

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };
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
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function harness(cfg) {
  const day = cfg.day, N = cfg.n;
  const NAMES = [];
  for (let i = 0; i < N; i++) NAMES.push('Pt' + String.fromCharCode(65 + (i % 26)) + i + ' Sample');
  const PROC = 'Lumbar medial branch block';
  window.__st = {
    longTasks: [],
    seed() {
      setTemplates([{ id: 't0', name: PROC, body: 'PROCEDURE: ' + PROC + '\nFINDINGS: [[findings]]', kind: 'op' }]);
      localStorage.setItem(uns('useTemplates'), '1');
      savePatients(NAMES.map((n, i) => ({ id: 'syn-' + i, name: n, dob: '1970-01-01',
        mrn: 'MRN' + (100 + i), athenaId: String(900 + i), notes: [], visits: [] })));
      window._calAppts = NAMES.map((n, i) => ({ id: 'a' + i, name: n, patientId: 'syn-' + i,
        appt_date: day, start_at: day + 'T0' + (8 + (i % 8)) + ':00:00', reason: PROC,
        providerName: 'Sample Provider, MD' }));
      try { renderPatients(); } catch (e) {}
      try {
        const po = new PerformanceObserver((l) => {
          l.getEntries().forEach((e) => { if (e.duration > 50) window.__st.longTasks.push(Math.round(e.duration)); });
        });
        po.observe({ entryTypes: ['longtask'] });
      } catch (e) {}
      return getPatients().length;
    },
    open() {
      try { openOpPrep(day); } catch (e) {}
      window._opPrep = NAMES.map((n, i) => _opNewRow(n, PROC, '1970-01-01', day, 'syn-' + i,
        { name: n, reason: PROC }, day));
      try { opPrepRender(); } catch (e) {}
      const m = document.getElementById('opPrepModal'); if (m) m.classList.add('show');
      return (document.getElementById('opPrepList') || { children: [] }).children.length;
    },
    stubGen() {
      if (!window.__stBase) window.__stBase = window.opPrepGenerateOne;
      window.opPrepGenerateOne = function (i) {
        const r = (window._opPrep || [])[i];
        if (r) { r.gen = true; r.note = 'PROCEDURE: synthetic\nFINDINGS: [[findings]]'; }
        try { opPrepRender(); } catch (e) {}
        return Promise.resolve(true);
      };
      return true;
    },
    startDraftAll() { const b = document.getElementById('opPrepGenAllBtn'); if (b) b.click(); return !!b; },
    async click(i) {
      const modal = document.getElementById('opPrepModal');
      let burst = 0, lastAt = performance.now();
      const mo = new MutationObserver((recs) => { burst += recs.length; lastAt = performance.now(); });
      mo.observe(modal, { childList: true, subtree: true, attributes: true, characterData: true });
      const btn = document.getElementById('mlsOpnRow' + i);
      if (!btn) { mo.disconnect(); return null; }
      const t0 = performance.now();
      btn.click();
      const handler = performance.now() - t0;
      const started = performance.now();
      let stable = -1;
      for (let k = 0; k < 40; k++) {
        await new Promise((r) => setTimeout(r, 50));
        if (performance.now() - lastAt >= 200) { stable = Math.round(lastAt - started); break; }
      }
      mo.disconnect();
      if (stable < 0) stable = Math.round(performance.now() - started);
      return { i, handler: Math.round(handler * 10) / 10, burst, stable,
        sel: (window.__mlsOpDay ? window.__mlsOpDay.selected() : -2),
        state: (window.__mlsOpDay ? window.__mlsOpDay.state() : '') };
    },
    markRows() {
      const g = document.getElementById('mlsOpDayGrid');
      if (!g) return 0;
      for (let i = 0; i < g.children.length; i++) g.children[i].__stMark = 1;
      return g.children.length;
    },
    survivors() {
      const g = document.getElementById('mlsOpDayGrid');
      if (!g) return { n: 0, kept: 0 };
      let kept = 0;
      for (let i = 0; i < g.children.length; i++) if (g.children[i].__stMark) kept++;
      return { n: g.children.length, kept };
    },
    /* the mark must still be right after all that */
    marked() {
      const g = document.getElementById('mlsOpDayGrid');
      if (!g) return { n: -1, id: '' };
      const on = g.querySelectorAll('.mlsOpDayCard[aria-current="true"]');
      return { n: on.length, id: on.length ? (on[0].id || '') : '' };
    }
  };
}

async function run() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsOpDay, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      const st = document.createElement('style');
      st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
      document.head.appendChild(st);
      window.__mlsHarnessAccountEmail = 'storm-harness@mlsscribe.test';
    });
    await page.evaluate(harness, { day: DAY, n: N_PATIENTS });
    eq(await page.evaluate(() => window.__st.seed()), N_PATIENTS, 'the synthetic roster did not land');
    await page.evaluate(() => window.__st.stubGen());
    const cards = await page.evaluate(() => window.__st.open());
    ok(cards >= N_PATIENTS, `the room rendered ${cards} cards for a ${N_PATIENTS}-patient day`);
    await page.waitForTimeout(1500);
    ok(await page.evaluate(() => window.__st.startDraftAll()), 'there is no Draft-all button to start a run with');
    await page.waitForTimeout(600);

    eq(await page.evaluate(() => window.__st.markRows()), N_PATIENTS,
      'the rail did not render one row per patient, so the storm would measure nothing');

    const rows = [];
    for (let k = 0; k < SWITCHES; k++) {
      const i = (k * 3 + 1) % N_PATIENTS;
      const r = await page.evaluate((ix) => window.__st.click(ix), i);
      ok(r, `switching to patient ${i} found no row button`);
      rows.push(r);
    }
    const surv = await page.evaluate(() => window.__st.survivors());
    const marked = await page.evaluate(() => window.__st.marked());
    const longTasks = await page.evaluate(() => window.__st.longTasks.slice());

    const steady = rows.slice(1);
    const pick = (a, f) => a.map(f);
    const max = (a) => (a.length ? Math.max.apply(null, a) : 0);
    const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    measured.handler = pick(rows, (r) => r.handler);
    measured.burst = pick(rows, (r) => r.burst);
    measured.stable = pick(rows, (r) => r.stable);
    measured.longTasks = longTasks;
    measured.survivors = surv;

    /* 1. THE ROWS SURVIVE. This is the property; everything below is its cost. */
    eq(surv.kept, surv.n,
      `${surv.n - surv.kept} of ${surv.n} rail rows were rebuilt during ${SWITCHES} switches — selecting a patient must MARK a row, not re-create the list (it also throws away the rail's scroll position, focus and hover)`);

    /* 2. and the mark is still correct, and singular */
    eq(marked.n, 1, `${marked.n} rows carry aria-current after the storm — exactly one patient is open`);
    eq(marked.id, 'mlsOpnRow' + rows[rows.length - 1].i,
      `the marked row is ${marked.id} after switching to ${rows[rows.length - 1].i}`);
    eq(rows[rows.length - 1].sel, rows[rows.length - 1].i, 'the room lost track of which patient is selected');
    eq(rows[rows.length - 1].state, 'note', 'the room is not on the note surface after a switch');

    /* 3. no click may block the main thread long enough to feel stuck */
    for (const r of rows) {
      ok(r.handler < MAX_HANDLER_MS,
        `switching to patient ${r.i} blocked the main thread for ${r.handler}ms (budget ${MAX_HANDLER_MS}ms) — all: ${JSON.stringify(measured.handler)}`);
    }
    /* 4. the steady state: bursts and time-to-quiet */
    for (const r of steady) {
      ok(r.burst <= MAX_STEADY_BURST,
        `a settled switch produced ${r.burst} mutations (budget ${MAX_STEADY_BURST}) — all: ${JSON.stringify(measured.burst)}`);
      ok(r.stable <= MAX_STEADY_STABLE_MS,
        `a settled switch took ${r.stable}ms to stop repainting (budget ${MAX_STEADY_STABLE_MS}ms) — all: ${JSON.stringify(measured.stable)}`);
    }

    eq(pageErrors.length, 0, `the shell threw during the storm: ${JSON.stringify(pageErrors.slice(0, 3))}`);

    measured.summary = {
      handler: { max: max(measured.handler), avg: avg(measured.handler) },
      burstSteady: { max: max(pick(steady, (r) => r.burst)), avg: avg(pick(steady, (r) => r.burst)) },
      stableSteady: { max: max(pick(steady, (r) => r.stable)), avg: avg(pick(steady, (r) => r.stable)) },
      firstSwitch: rows[0]
    };
  } finally {
    await browser.close();
    srv.close();
  }
}

run().then(() => {
  console.log(`1p-opnote-storm-perf: ${checks} checks passed`);
  const s = measured.summary;
  console.log(`  ${SWITCHES} switches on a ${N_PATIENTS}-patient day with a draft-all running`);
  console.log(`  click handler ms   : max ${s.handler.max}  avg ${s.handler.avg}   ${JSON.stringify(measured.handler)}`);
  console.log(`  mutation burst     : steady max ${s.burstSteady.max}  avg ${s.burstSteady.avg}   ${JSON.stringify(measured.burst)}`);
  console.log(`  stable paint ms    : steady max ${s.stableSteady.max}  avg ${s.stableSteady.avg}   ${JSON.stringify(measured.stable)}`);
  console.log(`  long tasks >50ms   : ${measured.longTasks.length}  ${JSON.stringify(measured.longTasks.slice(0, 10))}`);
  console.log(`  rail rows          : ${measured.survivors.kept} of ${measured.survivors.n} original nodes survived`);
  console.log(`  first switch (inside the draft-all start burst, not budgeted): ${JSON.stringify(s.firstSwitch)}`);
}).catch((e) => {
  console.error('1p-opnote-storm-perf FAILED:', e && e.message);
  process.exit(1);
});
