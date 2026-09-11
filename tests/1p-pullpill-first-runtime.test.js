'use strict';

/* pillfirst-1.0.0 - THE PULL STAYS IN THE CORNER PILL UNTIL ASKED
 *
 * OWNER, 2026-09-11, verbatim: "when I'm pulling why does this big thing pop
 * up, no need for that".
 *
 * The big thing is the full-screen pull card ("Pulling patient histories from
 * athenaOne", with Stop pull / Hide (keep pulling)). Every automatic caller -
 * pull start, a phase flip, a needs-attention settle, the day-note catch-up,
 * a month job's next day - reaches that card through exactly ONE door:
 * render(), polling window.__mlsDayHistoryPull.state on its own 900 ms clock.
 * What made that one door open by itself was `hidden`: RUN-SCOPED state that
 * outlived its run. It is cleared by the pill's click and re-armed only where
 * render() tears the surface down, so a doctor who opened the card once and
 * did not press Done left it cleared - and the NEXT run (the catch-up, the
 * next day of a month job, a second Pull) found the door open and painted the
 * card over the app with nobody having asked.
 *
 * WHAT THIS SUITE PROVES, in the real /1p shell, driven through the card's OWN
 * loop off the engine state it really reads (never through a test-only seam):
 *   (a) a pull that STARTS paints the corner pill and no dialog;
 *   (b) the pill opens the dialog on a click, and "Stop pull" is right there -
 *       so the doctor can still stop a pull in two clicks;
 *   (c) Hide returns to the pill and does not stop the engine;
 *   (d) THE REGRESSION: with the card left open, a NEW run returns to the pill
 *       instead of inheriting the open card;
 *   (e) a run that ENDS with rows needing attention says so IN THE PILL, and
 *       still does not open the dialog;
 *   (f) the results stay one click away - the pill opens the finished card.
 *
 * NO LOGIN, NO NETWORK, NO EXTENSION, NO PHI: synthetic names and synthetic
 * ids only, and nothing here is asserted to be persisted anywhere.
 *
 * SAID OUT LOUD, NOT PROVEN HERE: this suite never runs a real pull. It drives
 * the engine's published state object, which is the only thing this card reads.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const MC = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ------------------------------------------------------- PART 1: source == */
/* The gate itself, so a later lane cannot delete it and still read green on a
   runtime arm that happens never to exercise the boundary. */
{
  const a = MC.indexOf("var PANEL = 'mlsPullProgPanel'");
  const b = MC.indexOf('window.__mlsPullProgress = api;', a);
  ok(a > 0 && b > a, 'the pull-progress module could not be isolated');
  const mod = MC.slice(a, b);
  eq((mod.match(/userOpened = true/g) || []).length, 1,
    'exactly ONE place may open the pull dialog - a second opener is a second way for it to pop up on its own');
  ok(mod.includes('if (running && !wasRunning && userOpened) { userOpened = false; hidden = true; }'),
    'the run-boundary re-arm is gone - a new run would inherit an open card');
  ok(mod.includes('if (!userOpened && !hidden) hidden = true;'),
    '`hidden` is no longer derived from the doctor gesture');
  const added = mod.slice(mod.indexOf('/* ===== pillfirst-1.0.0'), mod.indexOf('var wasRunning'));
  eq((added.match(/[^\x00-\x7F]/g) || []).length, 0,
    'the new block carries non-ASCII bytes (the latin1 control-byte trap)');
}

/* ------------------------------------------------------ PART 2: runtime == */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
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

/* the card's own tick */
const TICK = 900;
const SETTLE = TICK * 3;

/* synthetic identities; none of these strings is real */
const NAMES = ['Quillon Ashgrove', 'Marisela Fenwick', 'Tobias Underhay', 'Perpetua Vandersloot', 'Ignatius Blackmoor'];

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsPullProgress, null, { timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    });
    await page.waitForTimeout(1500);

    /* THE INSTRUMENT MUST BE READY, or every assertion below grades a shell. */
    ok(await page.evaluate(() => !!(window.__mlsPullProgress && typeof window.__mlsPullProgress.humanWhy === 'function')),
      'INSTRUMENT NOT READY: the pull-progress card module is not mounted');

    /* ---- helpers, all in page context -------------------------------- */
    const read = () => page.evaluate(() => {
      const p = document.getElementById('mlsPullProgPanel');
      const f = document.getElementById('mlsPullProgFab');
      const sb = document.getElementById('mlsPullProgStop');
      return {
        dialog: !!p,
        dialogVisible: !!(p && getComputedStyle(p).display !== 'none'),
        pill: !!f,
        pillText: f ? String(f.textContent || '').replace(/\s+/g, ' ').trim() : '',
        stopText: sb ? String(sb.textContent || '').trim() : '',
        stopUsable: !!(sb && !sb.disabled && getComputedStyle(sb).display !== 'none'),
        engineRunning: !!(window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state && window.__mlsDayHistoryPull.state.running)
      };
    });
    const rowsFor = (n, failAt) => Array.from({ length: n }, (_, i) => ({
      k: 'syn-' + i, name: NAMES[i % NAMES.length], pid: 'syn-pid-' + i,
      ok: i !== failAt, reason: i === failAt ? 'read-failed' : ''
    }));
    const startRun = (rows, done) => page.evaluate(([rows, done]) => {
      window.__mlsDayHistoryPull = { state: {
        __si: 1, running: true, total: rows.length, done: done,
        ok: done, failed: 0, chartOnly: 0, current: 'opening the next chart',
        rows: rows.slice(0, done), runId: 'r' + Date.now().toString(36)
      } };
    }, [rows, done]);
    const endRun = (rows) => page.evaluate((rows) => {
      const failed = rows.filter((r) => !r.ok).length;
      window.__mlsDayHistoryPull.state = {
        __si: 1, running: false, total: rows.length, done: rows.length,
        ok: rows.length - failed, failed: failed, chartOnly: 0,
        finishedAt: Date.now(), rows: rows,
        dayVerdict: { ok: rows.length - failed, failed: failed, total: rows.length,
          complete: true, tnFailed: 0, tnRead: rows.length, tnNotYet: 0, tnFuture: 0, tnNotesComplete: true }
      };
    }, rows);
    const clickPill = () => page.evaluate(() => { const f = document.getElementById('mlsPullProgFab'); if (f) f.click(); });
    const clickHide = () => page.evaluate(() => { const b = document.getElementById('mlsPullProgHide'); if (b) b.click(); });

    const five = rowsFor(5, 4);   /* 4 saved, 1 that needs attention */

    /* ===== (a) a pull that STARTS never opens the dialog ================ */
    await startRun(five, 2);
    await page.waitForTimeout(SETTLE);
    let s = await read();
    eq(s.dialog, false, 'the pull opened the full-screen dialog on its own at start - this is the owner\'s report');
    ok(s.pill, 'a running pull painted no corner pill, so the doctor is told nothing and Stop pull has no route');
    ok(/show details/.test(s.pillText), `the running pill does not offer the details route: "${s.pillText}"`);
    ok(!/Pull done/.test(s.pillText), `a running pull's pill claims it is finished: "${s.pillText}"`);
    measured.a_runningPill = s.pillText;

    /* ===== (b) the pill opens it, and Stop pull is right there ========== */
    await clickPill();
    await page.waitForTimeout(TICK * 2);
    s = await read();
    ok(s.dialogVisible, 'the pill did not open the dialog - the details are unreachable');
    eq(s.stopText, 'Stop pull', `"Stop pull" is not on the opened dialog (found "${s.stopText}")`);
    ok(s.stopUsable, 'the opened dialog offers no usable Stop pull - a running pull could not be stopped');
    measured.b_stopRoute = 'pill click -> dialog -> ' + s.stopText;

    /* ===== (c) Hide returns to the pill and never stops the engine ====== */
    await clickHide();
    await page.waitForTimeout(TICK * 2);
    s = await read();
    eq(s.dialog, false, 'Hide left the dialog on screen');
    ok(s.pill, 'Hide took the pill away with the dialog - the pull became invisible');
    eq(s.engineRunning, true, 'Hide stopped the pull - "Hide (keep pulling)" must never touch the engine');

    /* ===== (d) THE REGRESSION: a NEW run returns to the pill ============ */
    /* The doctor opens the card; the run ends and the card stays open (that is
       the DONE card's contract, dn-1.0); then the next run starts. Before
       pillfirst-1.0.0 that run inherited the open card, and the doctor - who
       had asked for nothing - watched the big thing appear over the app. */
    await clickPill();
    await page.waitForTimeout(TICK * 2);
    ok((await read()).dialogVisible, 'the card could not be re-opened, so the boundary below is unmeasured');
    await endRun(five);
    await page.waitForTimeout(SETTLE);
    ok((await read()).dialogVisible, 'the DONE card did not stay open for the doctor who opened it (dn-1.0)');
    await startRun(five, 1);
    await page.waitForTimeout(SETTLE);
    s = await read();
    eq(s.dialog, false, 'a NEW run inherited the open card and painted the big dialog with nobody asking - the defect');
    ok(s.pill && /show details/.test(s.pillText),
      `the new run left no corner pill to work from: "${s.pillText}"`);
    measured.d_newRunPill = s.pillText;

    /* ===== (e) a run that ENDS needing attention says so IN THE PILL ==== */
    await endRun(five);
    await page.waitForTimeout(SETTLE);
    s = await read();
    eq(s.dialog, false, 'the finished pull opened the dialog on its own - a result is not a request to see it');
    ok(/Pull done/.test(s.pillText), `the finished pill does not say the pull is done: "${s.pillText}"`);
    ok(/1 needs attention/.test(s.pillText),
      `the finished pill does not name the row that needs attention: "${s.pillText}"`);
    ok(/show details/.test(s.pillText), `the finished pill offers no route to the results: "${s.pillText}"`);
    measured.e_donePill = s.pillText;

    /* ===== (f) the results are still one click away ===================== */
    await clickPill();
    await page.waitForTimeout(TICK * 2);
    const card = await page.evaluate(() => {
      const p = document.getElementById('mlsPullProgPanel');
      if (!p) return null;
      const g = (k) => { const e = p.querySelector('[data-pp="' + k + '"]'); return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
      return { tally: g('tally'), rows: p.querySelectorAll('.pp-row').length };
    });
    ok(card, 'the finished pill does not open the result card, so the results are lost');
    ok(/need attention/.test(card.tally),
      `the opened card and the pill disagree about attention: card "${card.tally}" vs pill "${measured.e_donePill}"`);
    eq(card.rows, 5, `the opened result card should list 5 rows, it listed ${card.rows}`);
    measured.f_cardTally = card.tally;

    /* leave the app as it was found */
    await page.evaluate(() => { try { window.__mlsDayHistoryPull = { state: null }; } catch (e) {} });
    await page.waitForTimeout(SETTLE);
    eq((await read()).pill, false, 'the surface did not clean itself up when the engine released');

    ok(pageErrors.length === 0, 'the page threw during the run: ' + pageErrors.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED');
  for (const k of Object.keys(measured)) console.log('  ' + k + ': ' + measured[k]);
  console.log('PASS 1p pull pill first: ' + checks + ' checks passed - the dialog opens only when the doctor asks, at every run boundary, and the pill carries the verdict');
}, (err) => {
  console.error((err && err.stack) || err);
  process.exit(1);
});
