'use strict';

/* /1p PROGRESS HONESTY CONTRACT — pshonest-1.0.0 + p1-backfill-progress-1.0.0
 *
 * THE MEASUREMENT THIS SUITE EXISTS FOR. Owner, 2026-08-18, from his own
 * screenshot of the progress widget:
 *
 *     Pulling patient history · Done · 15s · repeated 2 times
 *     ✓ Opening charts in Athena  ✓ Reading each chart  ✓ Analyzing pulled history
 *     No charts were read.
 *
 * PART 2 §1 reproduces that card from the app's OWN bridge traffic — the exact
 * two messages the visit-list top-up posts per patient — and asserts the
 * baseline defect is present with this lane's block disabled, then gone with it
 * enabled. Both halves are measured on the same page, in the same state, so the
 * result is causal and not a happy sample.
 *
 * WHY THE FIX IS A SHELL OVERLAY. The three ✓ come from ONE line in
 * feat_mls_progress_stages.js — SHARED production bytes this lane must not
 * touch:
 *     var doneAll = !ACTIVE_STATUS[j.status] && (j.status === 'completed');
 * A completed job paints every stage done regardless of what it counted. §1 of
 * PART 1 pins that line: if production ever fixes it, this suite fails and the
 * overlay should be retired rather than left to rot.
 *
 * WHAT MUST STAY TRUE ON THE OTHER SIDE. A history pull that really read charts
 * keeps every ✓ (PART 2 §2). The overlay only ever acts on a terminal
 * count-bearing job whose own count is 0.
 *
 * No login, no network, no PHI — synthetic names only.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ============================================================ PART 1 static */

function blockOf(src, name) {
  const a = src.indexOf('<!-- ===== ' + name);
  const b = src.indexOf('<!-- ===== end ' + name);
  return (a >= 0 && b > a) ? src.slice(a, b) : '';
}

/* §1 the production defect this block exists to cover is still there */
{
  const ps = read('feat_mls_progress_stages.js');
  ok(ps.indexOf("var doneAll = !ACTIVE_STATUS[j.status] && (j.status === 'completed');") > 0,
    'feat_mls_progress_stages.js no longer paints every stage done from status alone — if production fixed this, RETIRE pshonest-1.0.0 instead of keeping a dead overlay');
  ok(ps.indexOf("finish('history', 'complete', 'No charts were read.')") > 0,
    'the zero-read completion path changed shape — re-measure before trusting this suite');
  ok(ps.indexOf("else if (d.type === 'mlsAppReadVisits') historyTouch(0, 'Reading the visits list'") > 0,
    'a visit-LIST read no longer opens a history job — the manufactured card may be gone; re-measure');
}

/* §2 the overlay is in BOTH twins, identically, and is lane-neutral */
for (const shell of SHELLS) {
  const blk = blockOf(read(shell), 'pshonest-1.0.0');
  ok(blk.length > 3000, `${shell}: pshonest-1.0.0 is missing or truncated`);
  ok(/COUNT_BEARING\s*=\s*\{\s*history_pull:\s*1\s*\}/.test(blk),
    `${shell}: the overlay lost its explicit count-bearing scope`);
  ok(blk.indexOf("if ((Number(job.current) || 0) > 0) continue;") > 0,
    `${shell}: the overlay no longer leaves a job that really counted work alone`);
  ok(blk.indexOf('data-mls-dupe') > 0, `${shell}: the duplicate-card rule is gone`);
  for (const bad of ['__MLS_P1_PREVIEW', "'/1p/'", '1p-feat_']) {
    ok(blk.indexOf(bad) < 0, `${shell}: pshonest-1.0.0 references ${bad}`);
  }
}
eq(blockOf(read(SHELLS[0]), 'pshonest-1.0.0'), blockOf(read(SHELLS[1]), 'pshonest-1.0.0'),
  'the twins carry DIFFERENT pshonest-1.0.0 blocks');

/* §3 the source half lives in the FORK only */
{
  const fork = read('1p-feat_mls_b121_pack.js');
  const shared = read('feat_mls_b121_pack.js');
  ok(fork.indexOf('/* ===== p1-backfill-progress-1.0.0') > 0,
    'the fork lost the p1-backfill-progress-1.0.0 block');
  ok(fork.indexOf('/* ===== end p1-backfill-progress-1.0.0') > 0,
    'the p1-backfill-progress-1.0.0 block is unclosed in the fork');
  ok(shared.indexOf('p1-backfill-progress-1.0.0') < 0,
    'the 1p block leaked into the SHARED production pack');
  ok(fork.indexOf("key: 'visits:backfill', kind: 'visits_backfill'") > 0,
    'the backfill no longer names its own job in the shared progress store');
  /* PHI: the job carries counts, never a patient name */
  const blk = fork.slice(fork.indexOf('/* ===== p1-backfill-progress-1.0.0'),
    fork.indexOf('/* ===== end p1-backfill-progress-1.0.0'));
  ok(blk.indexOf('item.name') < 0 && blk.indexOf('STATE.current') < 0,
    'the backfill progress block reaches for a patient name — counts only');
}

/* ============================================================ PART 2 runtime */

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

/* Read what the panel actually PAINTS. Card identity is the module's own
   grouping signature, so a card is found by its label. */
function reader() {
  window.__phT = {
    cards() {
      const panel = document.getElementById('mlsPsPanel');
      if (!panel) return [];
      return Array.prototype.map.call(panel.querySelectorAll('.ps-job'), (row) => ({
        label: (row.querySelector('.ps-label') || {}).textContent || '',
        status: (row.querySelector('.ps-chipst') || {}).textContent || '',
        msg: (row.querySelector('.ps-msg') || {}).textContent || '',
        why: (row.querySelector('.ps-why') || {}).textContent || '',
        dupe: row.getAttribute('data-mls-dupe') === '1',
        display: getComputedStyle(row).display,
        marks: Array.prototype.map.call(row.querySelectorAll('.ps-stages li'), (li) => ({
          mark: (li.querySelector('.ps-mk') || {}).textContent || '',
          cls: li.className
        }))
      }));
    },
    card(label) { return window.__phT.cards().filter((c) => c.label === label)[0] || null; },
    /* the panel repaints from the store on every job event; closing and
       reopening forces a full rebuild, which is how the A/B baseline is taken */
    repaint() {
      const ps = window.__mlsProgressStages;
      ps.panel.close(); ps.panel.open();
      if (window.__mlsPsHonest) window.__mlsPsHonest.pass();
      return true;
    },
    jobs() {
      return window.__mlsLoadingCalm.snapshot().map((j) => ({
        key: j.key, kind: j.kind, status: j.status, current: j.current, total: j.total,
        stageIndex: j.stageIndex, message: j.message, startedAt: j.startedAt, finishedAt: j.finishedAt
      }));
    }
  };
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsProgressStages && !!window.__mlsLoadingCalm, null, { timeout: 60000 });
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    });
    await page.evaluate(reader);

    eq(await page.evaluate(() => (window.__mlsPsHonest || {}).version), 'pshonest-1.0.0',
      'pshonest-1.0.0 did not install on the running page');
    eq(await page.evaluate(() => window.__mlsProgressStages.version), 'ps-1.3.0',
      'the shared progress module under test is not the version this block was measured against');

    /* ---- §1 REPRODUCE the owner's card from the app's own traffic ------ */
    await page.evaluate(() => {
      window.postMessage({ type: 'mlsAppSearchOpenPatient', source: 'mls-app', name: 'Ada Sample', dob: '01/02/1970', __vbf: 1 }, '*');
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.postMessage({ type: 'mlsAppReadVisits', source: 'mls-app', from: 'mls-app', __vbf: 1,
        patient: 'Ada Sample', name: 'Ada Sample', dob: '01/02/1970', athenaId: '', max: 30 }, '*');
    });
    /* the module's own 12s quiet window + 3s analysis grace */
    await page.waitForTimeout(16500);

    const manufactured = (await page.evaluate(() => window.__phT.jobs()))
      .filter((j) => j.key === 'history:pull' && j.status === 'completed');
    ok(manufactured.length >= 1, 'a visit-LIST read no longer manufactures a history job — re-measure this lane');
    eq(manufactured[0].current, 0, 'the manufactured history job counted charts it never read');
    eq(manufactured[0].message, 'No charts were read.', 'the manufactured job no longer carries the owner-reported subtitle');
    measured.manufacturedJob = manufactured[0];

    /* BASELINE: the block off, the same page, the same job */
    await page.evaluate(() => window.__mlsPsHonest.setEnabled(false));
    await page.evaluate(() => window.__phT.repaint());
    await page.waitForTimeout(250);
    const before = await page.evaluate(() => window.__phT.card('Pulling patient history'));
    ok(before, 'the manufactured card is not on the panel — nothing to measure');
    eq(before.marks.length, 3, `the history card should carry three stages, measured ${before.marks.length}`);
    eq(before.marks.filter((m) => m.mark === '✓').length, 3,
      `BASELINE: all three stages must show ✓ with the block off — that is the owner's screenshot. Measured ${JSON.stringify(before.marks)}`);
    eq(before.why, '', 'BASELINE: the card must carry no explanation with the block off');
    measured.before = before;

    /* WITH the block: no ✓ on work that did not happen, and one honest line */
    await page.evaluate(() => window.__mlsPsHonest.setEnabled(true));
    await page.evaluate(() => window.__phT.repaint());
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => window.__phT.card('Pulling patient history'));
    ok(after, 'the manufactured card disappeared entirely — this block marks stages, it does not delete cards');
    eq(after.marks.filter((m) => m.mark === '✓').length, 0,
      `WITH pshonest-1.0.0: a job that read nothing must show no ✓. Measured ${JSON.stringify(after.marks)}`);
    eq(after.marks.filter((m) => m.mark === '○').length, 3,
      `WITH pshonest-1.0.0: all three stages must read NOT done. Measured ${JSON.stringify(after.marks)}`);
    eq(after.marks.filter((m) => m.cls === 'ps-notdone').length, 3,
      'the not-done stages did not take the amber class, so they would read as ordinary grey');
    eq(after.msg, 'No charts were read.', "production's honest subtitle must survive untouched");
    ok(/visit-list top-up/.test(after.why),
      `the card must name what really ran; measured "${after.why}"`);
    ok(/Pull day histories/.test(after.why),
      `the card must say what to press for a real chart pull; measured "${after.why}"`);
    measured.after = after;

    /* ---- §2 THE OTHER SIDE: a pull that really read charts keeps its ✓ -- */
    await page.evaluate(() => {
      const h = window.__mlsLoadingCalm.start({
        key: 'history:pull:probe', kind: 'history_pull', label: 'Pulling patient history (probe)',
        stages: ['Opening charts in Athena', 'Reading each chart', 'Analyzing pulled history'], timeoutMs: 60000
      });
      h.progress(3, 3, 'Reading chart 3 of 3');
      h.complete('Read 3 charts.');
    });
    await page.evaluate(() => window.__phT.repaint());
    await page.waitForTimeout(250);
    const real = await page.evaluate(() => window.__phT.card('Pulling patient history (probe)'));
    ok(real, 'the real-work card is missing');
    eq(real.marks.filter((m) => m.mark === '✓').length, 3,
      `TWO-SIDED: a history pull that read 3 charts must keep all three ✓. Measured ${JSON.stringify(real.marks)}`);
    eq(real.why, '', 'a card with real work must not be given an explanation it does not need');
    measured.realWork = real;

    /* A pull whose chart identities were already cached reads only visit
       BODIES, and that job also lands with count 0. It must not be told to go
       check its Athena tab — the read was fine, there was simply nothing for
       this job to count. */
    const bodyWhy = await page.evaluate(() => {
      window.postMessage({ source: 'mls-app', type: 'mlsAppReadAllVisits', name: 'Bo Sample' }, '*');
      return new Promise((r) => setTimeout(() => {
        const job = { startedAt: Date.now() - 500, finishedAt: Date.now() + 500 };
        r(window.__mlsPsHonest._why(job));
      }, 300));
    });
    ok(/visit-body reads/.test(bodyWhy), `a visit-body job must not be blamed on the Athena tab; measured "${bodyWhy}"`);
    ok(!/Leave exactly one signed-in/.test(bodyWhy), `the overlay blamed the doctor's Athena tab for a healthy read: "${bodyWhy}"`);
    measured.bodyWhy = bodyWhy;

    /* ---- §3 the fork's own honest job, and the duplicate rule ---------- */
    const vbf = await page.evaluate(() => (window.__mlsVisitsBackfill ? window.__mlsVisitsBackfill.version : ''));
    ok(vbf, 'the visit backfill module is not on the page');
    const endText = await page.evaluate(() => {
      const B = window.__mlsVisitsBackfill;
      B._bpStart(2);                       /* captures the run baseline */
      B.state.ok += 2; B.state.done += 2; B.state.visitsAdded += 5;
      return { text: B.progressText(), ended: B._bpEnd() };
    });
    eq(endText.text, 'Read 2 visit lists — 5 new visits filed.',
      `the backfill's own ending is not the honest sentence: "${endText.text}"`);
    measured.backfillEnding = endText.text;

    /* The duplicate rule is a WINDOW rule: the honest job has to cover the
       manufactured one. Both are created here in that order, exactly as the
       pump does it — the backfill job spans the whole run, each manufactured
       history job lives inside it. */
    await page.evaluate(() => {
      const lb = window.__mlsLoadingCalm;
      window.__phH = lb.start({
        key: 'visits:backfill:probe', kind: 'visits_backfill', label: 'Filling in missing visit lists (probe)',
        stages: ['Opening each patient in Athena', 'Reading their visit list', 'Filing new visits'],
        total: 1, timeoutMs: 60000
      });
      const m = lb.start({
        key: 'history:pull:dupe', kind: 'history_pull', label: 'Pulling patient history (dupe probe)',
        stages: ['Opening charts in Athena', 'Reading each chart', 'Analyzing pulled history'], timeoutMs: 60000
      });
      m.complete('No charts were read.');
      window.__phH.complete('Read 1 visit list — 3 new visits filed.');
      window.__phT.repaint();
    });
    await page.waitForTimeout(250);
    const deduped = await page.evaluate(() => window.__phT.card('Pulling patient history (dupe probe)'));
    const honest = await page.evaluate(() => window.__phT.card('Filling in missing visit lists (probe)'));
    const older = await page.evaluate(() => window.__phT.card('Pulling patient history'));
    ok(honest, 'the honest backfill card is not on the panel');
    eq(honest.dupe, false, 'the honest card was hidden — the rule hides the manufactured one, never the truth');
    ok(honest.display !== 'none', 'the honest backfill card is not visible');
    ok(deduped, 'the manufactured card vanished from the DOM — it must be hidden, not destroyed');
    eq(deduped.dupe, true, 'the manufactured card was not marked a duplicate of the honest job');
    eq(deduped.display, 'none', 'the manufactured duplicate is still visible — one activity, one card');
    /* and the rule really is bounded by the window: a manufactured card from
       BEFORE this backfill ran keeps its own honest explanation */
    ok(older && older.dupe === false && older.display !== 'none',
      'an unrelated earlier card was hidden — the duplicate rule is not bounded by the job window');
    ok(/visit-list top-up/.test(older.why), 'the earlier card lost its explanation');
    measured.dedupe = { manufactured: deduped.display, honest: honest.display, unrelated: older.display };

    /* ---- §4 an auto-start that finds nothing says so ------------------- */
    const verdict = await page.evaluate(() => {
      const B = window.__mlsVisitsBackfill;
      const v = B._bpEdgeVerdict(0, { rows: [{ name: 'Ada Sample', ok: true }] });
      return { v: v, api: B.autoVerdict() };
    });
    eq(verdict.v.queued, 0, 'the empty-verdict recorded a queue it did not have');
    eq(verdict.v.reason, 'all-already-have-visits',
      `the empty auto-start must say WHY it found nothing; measured "${verdict.v.reason}"`);
    ok(/^(outcome|info|inline-only)$/.test(String(verdict.v.said)),
      `the empty verdict was refused by the quiet tray classifier: "${verdict.v.said}"`);
    eq(verdict.api.reason, verdict.v.reason, 'autoVerdict() does not report what the watcher recorded');
    /* the sentence must survive the REAL quiet-tray classifier — a line that
       classifies 'debug' is dropped and a line that classifies 'action' is
       refused by bfQuiet, so either way the doctor would learn nothing */
    const classed = await page.evaluate(() => {
      const q = window.__mlsQuietNotify;
      if (!q || typeof q.classify !== 'function') return { present: false };
      return {
        present: true,
        all: q.classify('Visit top-up: nothing to do - every patient in that pull already has visits on file.', ''),
        none: q.classify('Visit top-up: nothing to do - that pull returned no patients to check.', '')
      };
    });
    ok(classed.present, 'quietnotify-1.0.0 is not on the page — the classification below cannot be measured');
    ok(/^(outcome|info)$/.test(classed.all), `the "already has visits" verdict classifies ${classed.all}, so the tray would never show it`);
    ok(/^(outcome|info)$/.test(classed.none), `the "no patients" verdict classifies ${classed.none}, so the tray would never show it`);
    measured.verdictClass = classed;
    const noRows = await page.evaluate(() => window.__mlsVisitsBackfill._bpEdgeVerdict(0, { rows: [] }));
    eq(noRows.reason, 'pull-returned-no-patients',
      `a pull with no patients must be named as such; measured "${noRows.reason}"`);
    measured.autoVerdict = verdict.v;

    /* ---- §5 a pull with nothing to read still says so ------------------
       MEASURED before pullzero-1.0.0: with zero history targets the engine
       still calls ppStart(0, 0), the pill read "Pulling 0/0 — show details",
       and when the engine released, pill and panel were removed with no
       verdict at all. Driven here through the engine's own state object,
       which is exactly what the panel polls. */
    ok(await page.evaluate(() => !!window.__mlsPullProgress), '__mlsPullProgress is not on the page');
    await page.evaluate(() => {
      window.__mlsDayHistoryPull = window.__mlsDayHistoryPull || {};
      window.__mlsDayHistoryPull.state = { running: true, total: 0, done: 0, ok: 0, failed: 0, current: '', rows: [] };
    });
    await page.waitForTimeout(1400);   /* the panel's own 900ms poll */
    const zeroPill = await page.evaluate(() => {
      const f = document.getElementById('mlsPullProgFab');
      return f ? String(f.textContent || '') : '';
    });
    ok(/Checking this day/.test(zeroPill), `a 0-target pull still counts nothing: pill reads "${zeroPill}"`);
    ok(!/0\/0/.test(zeroPill), `the pill still shows a count of nothing: "${zeroPill}"`);
    await page.evaluate(() => { const f = document.getElementById('mlsPullProgFab'); if (f) f.click(); });
    await page.evaluate(() => { window.__mlsDayHistoryPull.state.running = false; window.__mlsDayHistoryPull.state.finishedAt = Date.now(); });
    await page.waitForTimeout(1400);
    const zeroDone = await page.evaluate(() => {
      const p = document.getElementById('mlsPullProgPanel');
      if (!p) return null;
      const g = (k) => { const el = p.querySelector('[data-pp="' + k + '"]'); return el ? String(el.textContent || '') : ''; };
      return {
        h3: (p.querySelector('h3') || {}).textContent || '',
        sub: (p.querySelector('.pp-sub') || {}).textContent || '',
        note: (p.querySelector('.pp-note') || {}).textContent || '',
        tally: g('tally'), current: g('current'),
        stopShown: (document.getElementById('mlsPullProgStop') || {}).style ? document.getElementById('mlsPullProgStop').style.display : '?'
      };
    });
    ok(zeroDone, 'the 0-target pull ended with no card at all — the doctor is told nothing');
    ok(/no chart to read/i.test(zeroDone.h3), `the closing card must name the outcome; measured "${zeroDone.h3}"`);
    ok(/No chart histories were read/.test(zeroDone.current), `the result line still reports a tally of nothing: "${zeroDone.current}"`);
    eq(zeroDone.tally, 'Nothing to read', `the summary chip still says "${zeroDone.tally}"`);
    ok(/pull the day again/.test(zeroDone.note), `the closing card must say what to check; measured "${zeroDone.note}"`);
    eq(zeroDone.stopShown, 'none', 'the finished zero-day card still offers Stop');
    measured.zeroDay = { pill: zeroPill, card: zeroDone };
    await page.evaluate(() => { try { delete window.__mlsDayHistoryPull.state; } catch (e) {} });

    /* ---- §6 the block owns no idle timers and leaves a clean page ------ */
    const idle = await page.evaluate(() => ({ passes: window.__mlsPsHonest.passes(), applied: window.__mlsPsHonest.applied(), dupes: window.__mlsPsHonest.dupesHidden() }));
    ok(idle.applied >= 1, 'the overlay never applied anything — it is not running');
    ok(idle.dupes >= 1, 'the duplicate rule never fired');
    measured.counters = idle;

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('1p-progress-honesty-contract: ' + checks + ' checks passed');
  console.log('  measured: ' + JSON.stringify(measured));
}).catch((e) => {
  console.error('1p-progress-honesty-contract FAILED:', e && e.message);
  process.exit(1);
});
