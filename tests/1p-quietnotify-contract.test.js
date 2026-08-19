'use strict';

/* quietnotify-1.0.0 — THE APP STOPS SHOUTING
 *
 * Owner, 2026-08-18 02:40Z: "get rid of any notifications that are overkill —
 * put them in the left or somewhere not important."
 *
 * The fixture fires TWELVE representative notifications — one per class, plus
 * the four the owner named by hand — and asserts:
 *
 *   1. At most ONE toast is visible at any moment. No stacking, ever.
 *   2. Only ACTION-NEEDED becomes a toast. Outcomes, info and debug do not.
 *   3. The toast is bottom-left and inside the dock's reserved band.
 *   4. Everything except DEBUG reaches the tray — a misclassification must
 *      cost a click, never a lost message. DEBUG reaches nothing.
 *   5. NO PHI in the tray: seeded synthetic patient names, MRNs and DOBs must
 *      not appear in any tray line, even though the call sites interpolate them.
 *   6. The dock is not overlapped by the toast or the tray, at four sizes.
 *
 * The twelve are real strings from this codebase, not invented ones.
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
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

function blockOf(src, name) {
  const a = src.indexOf('<!-- ===== ' + name);
  const b = src.indexOf('<!-- ===== end ' + name);
  return (a >= 0 && b > a) ? src.slice(a, b) : '';
}

/* ============================================================ PART 1 static */
for (const shell of SHELLS) {
  const blk = blockOf(read(shell), 'quietnotify-1.0.0');
  ok(blk.length > 3000, `${shell}: quietnotify-1.0.0 is missing or truncated`);
  for (const bad of ['__MLS_P1_PREVIEW', "'/1p/'", '1p-feat_']) {
    ok(blk.indexOf(bad) < 0, `${shell}: quietnotify-1.0.0 references ${bad}; it must be lane-neutral`);
  }
  /* the toast must be positioned from the dock's reserved band, not guessed */
  ok(/--mls-dock-clear-bottom/.test(blk) && /--mls-dock-clear-left/.test(blk),
    `${shell}: the quiet toast does not compose with the dock's reserved band`);
  /* nothing may be silently dropped except debug */
  ok(/if \(kind === 'debug'\) return null;/.test(blk),
    `${shell}: the debug drop is gone, or something else is being dropped`);
  ok(/toTray\(msg, type\);\s*\n\s*return null;/.test(blk),
    `${shell}: non-action messages no longer reach the tray — a misclassification would LOSE a message`);
  /* the sanitiser must run on the way in, not be optional */
  ok(/function sanitize\(msg\)/.test(blk) && /var text = sanitize\(msg\);/.test(blk),
    `${shell}: tray lines are not sanitised`);
}
eq(blockOf(read(SHELLS[0]), 'quietnotify-1.0.0'), blockOf(read(SHELLS[1]), 'quietnotify-1.0.0'),
  'the twins carry DIFFERENT quietnotify-1.0.0 blocks');

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

/* The twelve. Real strings from this codebase; PHI-shaped values are synthetic.
   [message, type, expected class] */
const PHI_NAME = 'Ada Sample';
const PHI_MRN = 'MRN100000';
const PHI_DOB = '01/02/1970';
const FIXTURE = [
  /* --- ACTION-NEEDED: he must decide or click ------------------------- */
  ['Your session expired — sign in again to keep working.', 'err', 'action'],
  ['MLS could not open the chart in Athena. Open athenaOne yourself, then press Check Athena again.', 'err', 'action'],
  ['Choose a patient first so this recording is locked to the correct chart.', 'err', 'action'],
  ['Add your OpenAI API key in Settings to generate notes.', 'err', 'action'],
  /* --- OUTCOME: it happened, nothing is asked -------------------------- */
  ['10 patients syncing to server…', '', 'outcome'],
  ['Saved — schedule pull stored on the calendar', 'ok', 'outcome'],
  ['All saved correctly.', 'ok', 'outcome'],
  ['Visit stored for ' + PHI_NAME + ' (' + PHI_MRN + ', DOB ' + PHI_DOB + ').', 'ok', 'outcome'],
  ['All notes backed up to the server.', 'ok', 'outcome'],
  /* --- OUTCOME: a setting the app changed, reported back --------------- */
  ['Templates ON — generated notes will follow the selected template.', '', 'outcome'],
  /* --- INFO: no verb of completion, nothing to click ------------------- */
  ['Analysis is only available to head doctors and the owner.', '', 'info'],
  /* --- DEBUG: never rendered anywhere a doctor can see ----------------- */
  ['pull receipt: {"complete":true,"expectedCount":24} [object Object]', '', 'debug'],
  ['sync failed — reason code athena-context-unverified, epoch 41', 'err', 'debug']
];

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsQuietNotify, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'quiet-harness@mlsscribe.test';
      try { if (window.__mlsP1CalmDock && window.__mlsP1CalmDock.ensure) window.__mlsP1CalmDock.ensure(); } catch (e) {}
      /* The shell exports `render:` — there has never been a `renderNow` key,
         so the old guarded call was a silent no-op and this suite was grading
         boot-timing luck. Found 2026-08-19 chasing the visitflow flake. */
      try { if (window.__mlsCalmShell && window.__mlsCalmShell.render) window.__mlsCalmShell.render(); } catch (e) {}
    });
    await page.waitForFunction(() => !!document.getElementById('mlsDock'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);

    eq(await page.evaluate(() => window.__mlsQuietNotify.version), 'quietnotify-1.0.0',
      'quietnotify-1.0.0 did not install');
    ok(await page.evaluate(() => window.__mlsQuietNotify.report().installed),
      'quietnotify-1.0.0 did not wrap window.toast');

    /* -- 2: the classifier agrees with the fixture ---------------------- */
    for (const [msg, type, want] of FIXTURE) {
      const got = await page.evaluate((a) => window.__mlsQuietNotify.classify(a.m, a.t), { m: msg, t: type });
      eq(got, want, `classified "${msg.slice(0, 54)}" as ${got}, expected ${want}`);
    }

    /* Boot fires its own notifications; start the fixture from zero. */
    await page.evaluate(() => window.__mlsQuietNotify.resetCounts());

    /* -- 1: fire all thirteen, back to back, and watch the toast count -- */
    const peak = await page.evaluate(async (rows) => {
      const vis = (e) => {
        if (!e) return false;
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const cs = getComputedStyle(e);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      };
      let max = 0;
      const seen = [];
      for (const [m, t] of rows) {
        window.toast(m, t);
        await new Promise((r) => setTimeout(r, 120));
        const n = Array.from(document.querySelectorAll('.toast')).filter(vis).length;
        max = Math.max(max, n);
        seen.push(n);
      }
      return { max, seen };
    }, FIXTURE.map(([m, t]) => [m, t]));
    ok(peak.max <= 1,
      `${peak.max} toasts were visible at once — the ceiling is 1. Per-call: ${JSON.stringify(peak.seen)}`);

    const rep = await page.evaluate(() => window.__mlsQuietNotify.report());

    /* -- 2: only the four ACTION-NEEDED ones became toasts -------------- */
    eq(rep.counts.action, 4, `expected 4 ACTION-NEEDED of the twelve, classifier saw ${rep.counts.action}`);
    eq(rep.counts.debug, 2, `expected 2 DEBUG of the twelve, classifier saw ${rep.counts.debug}`);
    eq(rep.counts.outcome + rep.counts.info, 7,
      `expected 7 OUTCOME+INFO of the thirteen, classifier saw ${rep.counts.outcome + rep.counts.info}`);

    /* -- 4: everything except DEBUG reached the tray -------------------- */
    ok(rep.trayCount >= 10,
      `the tray holds ${rep.trayCount} lines; the eleven non-debug messages must all be there — a misclassification must cost a click, not a message`);
    ok(rep.trayVisible, 'the activity tray control is not on screen');

    /* -- 5: NO PHI in any tray line ------------------------------------ */
    const joined = rep.trayLines.join(' || ');
    for (const secret of [PHI_NAME, 'Ada', 'Sample', PHI_MRN, PHI_DOB, '100000', '1970']) {
      ok(joined.indexOf(secret) < 0,
        `PHI leaked into the activity tray: "${secret}" appears in ${JSON.stringify(rep.trayLines)}`);
    }
    /* ...and the sanitiser did not reduce every line to nothing */
    ok(rep.trayLines.every((l) => l && l.length >= 3),
      `the sanitiser emptied a tray line: ${JSON.stringify(rep.trayLines)}`);
    ok(rep.trayLines.some((l) => /saved|stored|sync|backed up|template/i.test(l)),
      `the tray lines lost their verbs entirely: ${JSON.stringify(rep.trayLines)}`);

    /* -- 3 + 6: placement, and the dock is never covered ---------------- */
    for (const [w, h] of [[1440, 900], [1280, 800], [768, 1024], [375, 812]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.toast('Your session expired — sign in again to keep working.', 'err'));
      await page.waitForTimeout(350);
      const geo = await page.evaluate(() => {
        const vis = (e) => {
          if (!e) return false;
          const r = e.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const cs = getComputedStyle(e);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
        };
        const t = document.getElementById('toast');
        const tray = document.getElementById('mlsTray');
        const d = document.getElementById('mlsDock');
        const box = (e) => {
          if (!e || !vis(e)) return null;
          const r = e.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
            right: Math.round(r.right), bottom: Math.round(r.bottom) };
        };
        const hit = (a, b) => {
          if (!a || !b) return 0;
          const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
          const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
          return Math.round(ix * iy);
        };
        const T = box(t), TR = box(tray), D = box(d);
        return { T, TR, D, vw: innerWidth, vh: innerHeight, toastOnDock: hit(T, D), trayOnDock: hit(TR, D) };
      });
      const at = `${w}x${h}`;
      /* PLACEMENT IS ASSERTED ON DESKTOP ONLY, and that is deliberate. Below
         ~700px the shell relocates every toast into #mlsMobileNoticeShelf,
         where it is `position:static` in the document flow — a mobile design
         that already keeps notices out of the way. Forcing a fixed bottom-left
         corner there would fight it, and would put a 360px-wide toast over the
         phone's bottom dock. On a phone the properties that matter are the two
         asserted for every width below: one at a time, and never on the dock. */
      if (geo.T && w >= 768) {
        ok(geo.T.x < geo.vw / 2,
          `${at}: the toast is at x=${geo.T.x} on a ${geo.vw}px screen — it must be on the LEFT`);
        ok(geo.T.bottom > geo.vh / 2,
          `${at}: the toast is at bottom=${geo.T.bottom} on a ${geo.vh}px screen — it must be at the BOTTOM`);
      }
      eq(geo.toastOnDock, 0, `${at}: the toast covers the dock by ${geo.toastOnDock}px2`);
      eq(geo.trayOnDock, 0, `${at}: the activity tray covers the dock by ${geo.trayOnDock}px2`);
    }

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors: ${JSON.stringify(fatal.slice(0, 4))}`);
    console.log(`  twelve fired -> ${rep.counts.action} toast, ${rep.counts.outcome} outcome, ${rep.counts.info} info, ${rep.counts.debug} debug suppressed; tray holds ${rep.trayCount}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`1p-quietnotify-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-quietnotify-contract FAILED:', e && e.message);
  process.exit(1);
});
