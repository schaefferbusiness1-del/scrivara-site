'use strict';

/* /1p CALENDAR PULL SURFACE — four owner-reported defects, as properties.
 *
 * All four were reported on 2026-08-18 against the Calendar screen:
 *
 *   1. fdw-1.0.0    a FUTURE day's per-row note text ("day not here yet") read
 *                   as a failure. The owner mistook it for the day-note bug.
 *                   fd-1.0.0's stamps, receipts and skip semantics are pinned
 *                   UNCHANGED here; only the sentence moved.
 *   2. calmreceipt  the hero's verdict printed a paragraph of reconciliation
 *      -1.0.0       prose. It becomes one sentence with the full ledger,
 *                   VERBATIM, behind a closed <details>.
 *   3. calmbar      the pull bar was green->violet with its caption painted
 *      -1.0.0       centre, in white, ON the fill.
 *   4. caldaysel    with the Aug 19 day panel open and the Aug 19 pull
 *      -1.0.0       RUNNING, the hero re-labelled itself "Pull Tuesday, Aug 18"
 *                   mid-pull.
 *
 * PART 1 is static over 1p-mls-connect.js. PART 2 drives the real shell in real
 * headless Chrome — no login, no network, no PHI, synthetic names only.
 *
 * TWO TRAPS THIS SUITE SHARES WITH ITS NEIGHBOURS:
 *   - 1p-mls-connect.js and its feature modules are NOT loaded by the page on
 *     its own. Without window.__mlsEnsureUiBundle() this measures a bare shell.
 *   - feat_mls_calm_views.js (which BUILDS the hero and its label) and
 *     feat_mls_datalink_exact.js (which performs the automatic post-pull jump
 *     that causes defect 4) are both scheduled through requestIdleCallback,
 *     and requestIdleCallback never fires in a non-compositing tab. MEASURED:
 *     without loading them explicitly, window.__mlsCalmViews and
 *     window.__mlsLink are both undefined and every assertion about the hero
 *     passes vacuously. This suite mounts them the way a visible tab does.
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

/* ======================================================== PART 1: static */

const BLOCKS = [
  ['fdw-1.0.0', '/* ===== fdw-1.0.0', '/* ===== end fdw-1.0.0 ===== */'],
  ['calmreceipt-1.0.0', '/* ===== calmreceipt-1.0.0', '/* ===== end calmreceipt-1.0.0 ===== */'],
  ['calday-1.0.0', '/* ===== calday-1.0.0', '/* ===== end calday-1.0.0 ===== */'],
  ['calmbar-1.0.0', '/* ===== calmbar-1.0.0', '/* ===== end calmbar-1.0.0 ='],
  ['caldaysel-1.0.0', '/* ===== caldaysel-1.0.0', '/* ===== end caldaysel-1.0.0 =']
];
for (const [name, open, close] of BLOCKS) {
  const a = MC.indexOf(open), b = MC.indexOf(close);
  ok(a >= 0, `1p-mls-connect.js: ${name} block is missing`);
  ok(b > a, `1p-mls-connect.js: ${name} block is unclosed or closes before it opens`);
}

/* --- ITEM 1: the future-day row says nothing a failing row says ---------- */
{
  const m = MC.match(/dnRaw === 'future-day' \? '([^']*)'/);
  ok(m, 'the future-day row wording could not be found in rowsHtml');
  const text = m[1];
  measured.futureRowText = text;
  ok(!/not here/i.test(text), `the future-day row still says "not here": ${text}`);
  ok(!/not read\b/i.test(text), `the future-day row still says "not read": ${text}`);
  ok(/hasn/.test(text) && /nothing to read/.test(text) && /chart saved/.test(text),
    `the future-day row must say what is true and what was kept, got: ${text}`);
  /* the today-path wordings are untouched */
  ok(/dnRaw === 'not-yet' \? 'not seen yet'/.test(MC), 'the TODAY not-yet wording changed');
  ok(MC.indexOf("'today’s note not read yet — retrying'") > 0, 'the retrying wording changed');
  ok(MC.indexOf("'today’s note not read this time (chart saved)'") > 0, 'the spent-retry wording changed');
  ok(/dnRaw === 'read' \? 'note saved'/.test(MC), 'the read wording changed');
  /* fd-1.0.0 semantics are NOT touched: future-day stays a calm class, and is
     still never counted as a failure. */
  /* dnote-1.0.0 (b1184): PIN RE-AIMED. The calm class gained the two day-note
     DEBT states (queued:/reading:) and the "no note in athenaOne" state, so the
     literal expression moved. What this pin protects has NOT moved and is
     still asserted exactly: read is pp-ok, and not-yet / future-day / retrying
     are pp-wait, with everything else pp-bad. */
  ok(/dnCls = dnRaw === 'read' \? 'pp-ok'\s*:\s*\(\(dnRaw === 'not-yet' \|\| dnRaw === 'future-day' \|\| dnRetrying[^)]*\) \? 'pp-wait' : 'pp-bad'\)/.test(MC),
    'a future-day row is no longer classed pp-wait — the stamp semantics moved');
  /* the Result line states the future day once */
  const res = MC.match(/if \(dv && Number\(dv\.tnFuture \|\| 0\) > 0\) doneLine \+= '([^']*)'/);
  ok(res, 'the Result line does not state a future day at all');
  measured.futureResultClause = res[1];
  ok(/future/.test(res[1]) && !/not here/i.test(res[1]) && !/not read\b/i.test(res[1]),
    `the Result clause must not read as a failure, got: ${res[1]}`);
  eq(MC.split('Number(dv.tnFuture || 0) > 0').length - 1, 1, 'the future-day Result clause is emitted more than once');
}

/* --- ITEM 2: the fold exists, and it folds rather than trims ------------- */
{
  ok(/function verdictParts\(msg, result\)/.test(MC), 'verdictParts is missing');
  ok(/body\.textContent = parts\.full;/.test(MC), 'the Details body is not filled from the full message');
  ok(/full: text/.test(MC), 'verdictParts does not carry the ORIGINAL message forward verbatim');
  ok(!/\.slice\(0, ?\d+\)[^\n]*parts\.full/.test(MC), 'the folded receipt is being trimmed');
  ok(/sum\.textContent = 'Details';/.test(MC), 'the fold is not labelled "Details"');
  ok(!/det\.open = true/.test(MC), 'the Details fold is opened by default');
  /* psr-1.0.0 moved the literal settle() passes to paintVerdict from
     outcome.message to psrMessage (outcome.message plus an optional retry
     note) so a second attempt keeps its own honest verdict. Pin the
     PROPERTY, not that spelling: whatever identifier settle() computes and
     hands to paintVerdict must be the exact same identifier it falls back
     to for the toast, so the on-screen sentence and the repeated toast can
     never drift apart. */
  const verdictArgM = MC.match(/var vParts = paintVerdict\(el, (\w+(?:\.\w+)*), outcome\.ok \? 'ok' : 'err', result\);/);
  ok(verdictArgM, 'settle() does not route the verdict through paintVerdict');
  measured.settleVerdictArg = verdictArgM && verdictArgM[1];
  const toastArgM = MC.match(/window\.toast\(vParts \? vParts\.head : (\w+(?:\.\w+)*), outcome\.ok \? 'ok' : 'err'\)/);
  ok(toastArgM, 'the toast still repeats the whole paragraph');
  if (verdictArgM && toastArgM) {
    eq(verdictArgM[1], toastArgM[1],
      'paintVerdict and its toast fallback no longer fold the same message — they can drift apart');
  }
}

/* --- ITEM 3: no painter paints violet any more --------------------------- */
{
  const PAINTER = /background:linear-gradient\(90deg,#2E6A4B,(#[0-9A-Fa-f]{6})\);color:#fff;font:700 10px\/14px system-ui;text-align:center/g;
  const ends = [];
  let m;
  while ((m = PAINTER.exec(MC))) ends.push(m[1]);
  eq(ends.length, 4, `expected the four pull-bar painters, found ${ends.length}`);
  measured.painterGradientEnds = ends.join(',');
  for (const e of ends) eq(e, '#3B7C5A', `a pull-bar painter still ends its gradient at ${e}`);
  ok(/var FILL = 'linear-gradient\(90deg,#2E6A4B,#3B7C5A\)';/.test(MC), 'calmbar does not declare the calm green fill');
  ok(/font-size:0!important/.test(MC), 'the caption is still painted on the fill');
  ok(/text-align:left/.test(MC), 'the caption is not left-aligned');
}

/* --- ITEM 4: the pull publishes its day, and clears it exactly once ------ */
{
  ok(/try \{ window\.__mlsCalPullDay = day; \} catch \(ePd\) \{\}/.test(MC), 'runHeroPull does not publish the day it is pulling');
  ok(/try \{ window\.__mlsCalUserDayAt = Date\.now\(\); \} catch \(eUd\) \{\}/.test(MC),
    'runHeroPull does not stamp the day-choice the automatic jump honours');
  ok(/try \{ window\.__mlsCalPullDay = ''; \} catch \(ePd2\) \{\}/.test(MC), 'settle never clears the in-flight day');
  eq(MC.split("window.__mlsCalPullDay = ''").length - 1, 1, 'the in-flight day is cleared in more than one place');
  /* the clear must sit AFTER the transient-retry early return, or a re-read
     would drop the pin halfway through the run */
  const retryReturn = MC.indexOf('setTimeout(function () { if (mySerial === sessionSerial) runHeroPull(el, true); }, waitMs);');
  const clear = MC.indexOf("window.__mlsCalPullDay = ''");
  ok(retryReturn > 0 && clear > retryReturn, 'the in-flight day is cleared before the auto-retry branch returns');
  ok(/function wrapRender\(\)/.test(MC) && /function wrapOpen\(\)/.test(MC), 'caldaysel does not wrap both repaint entry points');
  ok(/w\.__calDaySelWrapped = true;/.test(MC), 'the wrap-once stamp is not on the wrapper');
}

/* ======================================================= PART 2: runtime */

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

/* --- contrast, computed here rather than trusted from a stylesheet ------- */
function chan(v) { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(rgb) { return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]); }
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
function parseRgb(s) {
  const m = String(s || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
  });
  await page.waitForTimeout(3000);
  /* THE TWO MODULES THIS CONTRACT NEEDS, which requestIdleCallback will never
     deliver in a non-compositing tab. */
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
  await page.evaluate(() => { try { const b = document.getElementById('nav_calendar'); if (b) b.click(); } catch (e) {} });
  await page.waitForTimeout(2500);
}

/* Seeds today + tomorrow through loadCalendar()'s own /api/appointments path —
   the calendar's real data source. Synthetic names only. */
function seedTwoDays() {
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  const d0 = new Date();
  const today = d0.getFullYear() + '-' + pad(d0.getMonth() + 1) + '-' + pad(d0.getDate());
  const d1 = new Date(d0.getTime() + 86400000);
  const target = d1.getFullYear() + '-' + pad(d1.getMonth() + 1) + '-' + pad(d1.getDate());
  const FIRST = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli'];
  const rows = [];
  let id = 9000;
  [today, target].forEach((key) => {
    for (let k = 0; k < FIRST.length; k++) {
      rows.push({
        id: ++id, name: FIRST[k] + ' Sample', appt_date: key,
        start_at: key + 'T' + pad(8 + k) + ':00:00', end_at: key + 'T' + pad(8 + k) + ':25:00',
        reason: 'Synthetic procedure', status: 'booked', provider: 'Sample Provider, MD'
      });
    }
  });
  try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
  if (!window.__cpsFetch) {
    const of = window.fetch.bind(window);
    window.fetch = function (u, o) {
      const s = String((u && u.url) || u || '');
      if (/\/api\/appointments(\?|$)/.test(s)) {
        return Promise.resolve(new Response(JSON.stringify({ appointments: window.__cpsRows, me: {} }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (/\/api\/providers/.test(s)) {
        return Promise.resolve(new Response(JSON.stringify({ providers: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return of(u, o);
    };
    window.__cpsFetch = true;
  }
  window.__cpsRows = rows;
  window.__cpsToday = today;
  window.__cpsTarget = target;
  window._calMode = 'month';
  const p = today.split('-');
  window._calYear = +p[0]; window._calMonth = +p[1] - 1;
  return window.loadCalendar().then((r) => ({ applied: !!(r && r.applied), count: r ? r.count : 0, today, target }));
}

function heroDayLabel() {
  const big = document.querySelector('#mlsCvNxt_calendar .mls-cv-big');
  return big ? String(big.textContent || '') : null;
}
function dayWords(key) {
  const d = new Date(key + 'T12:00');
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return DOW[d.getDay()] + ', ' + MON[d.getMonth()] + ' ' + d.getDate();
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(page, port);

    const mods = await page.evaluate(() => ({
      calmViews: !!(window.__mlsCalmViews),
      link: !!(window.__mlsLink && window.__mlsLink.installed),
      hero: !!(window.__mlsCalHeroPull && window.__mlsCalHeroPull.installed),
      daySel: !!(window.__mlsCalDaySel && window.__mlsCalDaySel.installed),
      calmBar: !!(window.__mlsCalmBar && window.__mlsCalmBar.installed),
      progress: !!(window.__mlsPullProgress)
    }));
    /* NON-VACUITY GATE. Every runtime assertion below is meaningless if these
       are not really on screen. */
    ok(mods.calmViews, 'feat_mls_calm_views.js did not install — every hero assertion would pass vacuously');
    ok(mods.link, 'feat_mls_datalink_exact.js did not install — defect 4 cannot be reproduced, so its fix cannot be proved');
    ok(mods.hero, 'chp-1.0.0 (the calendar hero contract) is not installed');
    ok(mods.daySel, 'caldaysel-1.0.0 is not installed');
    ok(mods.calmBar, 'calmbar-1.0.0 is not installed');
    ok(mods.progress, '__mlsPullProgress is not installed');

    const seeded = await page.evaluate(seedTwoDays);
    ok(seeded.applied && seeded.count === 10, `the two synthetic days did not land through loadCalendar (applied=${seeded.applied} count=${seeded.count})`);
    measured.seed = `${seeded.count} appointments across ${seeded.today} and ${seeded.target}`;
    /* let datalink's own deferred post-pull jumps (900 ms + 2400 ms) settle */
    await page.waitForTimeout(3500);

    /* ================================================== ITEM 4 (runtime) */
    /* The automatic jump this defect rides on resolves to TODAY whenever today
       has an appointment — it is not the day that was pulled. Proved, not
       assumed, because everything below is a differential against it. */
    const jumpTarget = await page.evaluate(() => window.__mlsLink.pulledDate());
    eq(jumpTarget, await page.evaluate(() => window.__cpsToday),
      'the automatic post-pull jump no longer resolves to today — the differential below would prove nothing');

    /* (a) CONTROL: the defect, reproduced. No pull marked, no day-choice
           stamp — the state a doctor's tab was in before this lane. */
    const control = await page.evaluate(async () => {
      const T = window.__cpsTarget;
      window.__mlsCalPullDay = '';
      window.__mlsCalUserDayAt = 0;
      window._calRefDate = T;
      window.calOpenDay(T);
      window.__mlsLink.syncAll('pull', true);
      window.renderCalendar();
      await new Promise((r) => setTimeout(r, 1800));
      const big = document.querySelector('#mlsCvNxt_calendar .mls-cv-big');
      return { ref: String(window._calRefDate), sel: String(window._calSelDay), hero: big ? String(big.textContent || '') : null };
    });
    const TODAY = await page.evaluate(() => window.__cpsToday);
    const TARGET = await page.evaluate(() => window.__cpsTarget);
    measured.item4Control = `${control.ref} / hero "${control.hero}"`;
    eq(control.ref, TODAY, `the automatic jump did not steal the day, so this suite cannot prove it was stopped (ref=${control.ref})`);
    ok(control.hero && control.hero.indexOf(dayWords(TODAY)) >= 0,
      `the control did not reproduce the owner's symptom; hero read "${control.hero}"`);

    /* (b) THE OWNER'S SCENARIO: the target day's panel open, a pull for that
           day in flight, marked exactly the way runHeroPull marks it. */
    const inFlight = await page.evaluate(async () => {
      const T = window.__cpsTarget;
      window.__mlsCalPullDay = T;                 /* runHeroPull publishes this */
      window.__mlsCalUserDayAt = Date.now();      /* ...and stamps this */
      window.calOpenDay(T);
      window.__mlsLink.syncAll('pull', true);
      window.renderCalendar();
      await new Promise((r) => setTimeout(r, 1800));
      const big = document.querySelector('#mlsCvNxt_calendar .mls-cv-big');
      const panel = document.getElementById('calDayPanel');
      return {
        ref: String(window._calRefDate), sel: String(window._calSelDay),
        hero: big ? String(big.textContent || '') : null,
        panelShown: !!(panel && getComputedStyle(panel).display !== 'none'),
        heroDisabled: !!(document.getElementById('mlsCvNxt_calendar') || {}).disabled,
        report: window.__mlsCalDaySel.report()
      };
    });
    measured.item4InFlight = `${inFlight.ref} / hero "${inFlight.hero}"`;
    eq(inFlight.ref, TARGET, 'a repaint moved the pull target off the day the pull is running for');
    eq(inFlight.sel, TARGET, 'a repaint moved the OPEN day panel off the day the pull is running for');
    ok(inFlight.panelShown, 'the day panel closed under the running pull');
    ok(inFlight.hero && inFlight.hero.indexOf(dayWords(TARGET)) >= 0,
      `the hero re-targeted mid-pull; it reads "${inFlight.hero}" and the pull is for ${TARGET}`);
    /* THE CONTRACT, stated as one identity: what the hero offers IS the day
       whose panel is open. */
    eq(inFlight.hero.indexOf(dayWords(inFlight.sel)) >= 0, true,
      `hero/panel desync: hero "${inFlight.hero}" vs open panel ${inFlight.sel}`);

    /* (c) THE PIN ON ITS OWN. The stamp is cleared, so the automatic jump is
           NOT braked and actively tries to move the day; only the pin can hold
           it. This is what separates "the fix works" from "the brake worked". */
    const pinAlone = await page.evaluate(async () => {
      const T = window.__cpsTarget;
      window.__mlsCalPullDay = T;
      window.__mlsCalUserDayAt = 0;               /* no brake */
      window._calRefDate = T; window._calSelDay = T;
      window.calOpenDay(T);
      const before = window.__mlsCalDaySel.report();
      window.__mlsLink.syncAll('pull', true);
      window.renderCalendar();
      await new Promise((r) => setTimeout(r, 1800));
      const big = document.querySelector('#mlsCvNxt_calendar .mls-cv-big');
      const after = window.__mlsCalDaySel.report();
      return {
        ref: String(window._calRefDate), sel: String(window._calSelDay),
        hero: big ? String(big.textContent || '') : null,
        reopens: after.reopens - before.reopens, pins: after.pins - before.pins
      };
    });
    measured.item4PinAlone = `${pinAlone.ref} / reopens+${pinAlone.reopens} pins+${pinAlone.pins}`;
    eq(pinAlone.ref, TARGET, 'with the brake off, the pin did not hold the running pull\'s day');
    eq(pinAlone.sel, TARGET, 'with the brake off, the pin did not hold the running pull\'s panel');
    ok(pinAlone.reopens >= 1, 'the automatic jump never re-opened another day, so the re-open guard was never exercised');
    ok(pinAlone.hero && pinAlone.hero.indexOf(dayWords(TARGET)) >= 0,
      `with the brake off the hero drifted to "${pinAlone.hero}"`);

    /* (d) A REAL CLICK on a day cell is a day CHOICE, and survives the jump. */
    const clicked = await page.evaluate(async () => {
      window.__mlsCalPullDay = '';
      window.__mlsCalUserDayAt = 0;
      window.calToday();
      await new Promise((r) => setTimeout(r, 400));
      const T = window.__cpsTarget;
      const cells = Array.prototype.slice.call(document.querySelectorAll('#calGrid [onclick]'));
      const cell = cells.filter(function (c) { return /^calOpenDay\('/.test(c.getAttribute('onclick') || '') && (c.getAttribute('onclick') || '').indexOf(T) >= 0; })[0];
      if (!cell) return { found: false };
      const before = window.__mlsCalDaySel.report();
      cell.click();
      window.__mlsLink.syncAll('pull', true);
      window.renderCalendar();
      await new Promise((r) => setTimeout(r, 1800));
      const big = document.querySelector('#mlsCvNxt_calendar .mls-cv-big');
      const after = window.__mlsCalDaySel.report();
      return {
        found: true, ref: String(window._calRefDate), sel: String(window._calSelDay),
        hero: big ? String(big.textContent || '') : null, stamps: after.stamps - before.stamps
      };
    });
    ok(clicked.found, 'no month cell for the target day was rendered, so the click path could not be measured');
    measured.item4Click = `${clicked.ref} / stamps+${clicked.stamps} / hero "${clicked.hero}"`;
    ok(clicked.stamps >= 1, 'clicking a day cell did not register as a day choice');
    eq(clicked.ref, TARGET, 'the automatic jump repainted over a day the doctor had just clicked');
    ok(clicked.hero && clicked.hero.indexOf(dayWords(TARGET)) >= 0,
      `the hero does not offer the day panel the doctor just opened; it reads "${clicked.hero}"`);

    /* ================================================== ITEM 2 (runtime) */
    const OWNER_MSG = 'Wed, Aug 19 is ready — 19 appointments reconciled, history read for 19 of 19 as the reader counted it. Chart content in MLS: 19 of 19 patients. 19 of 19 stored records changed during this pull. [expected 19 · found 19 · resolved 19 (3 new) · unresolved 0]';
    const verdict = await page.evaluate((msg) => {
      const result = {
        ok: true, complete: true,
        scheduleReceipt: { expectedCount: 19, parsedCount: 19 },
        calendarReceipt: { attempted: 19, mapped: 19, created: 3, skipped: 16, failed: 0 },
        historyReceipt: {
          requested: 19, processed: 19, todayNoteFailures: 0,
          patients: Array.from({ length: 19 }, (_, i) => ({ id: 'syn-' + i, complete: true })),
          storeCensus: { measured: true, targets: 19, withContent: 19 },
          storeDelta: { measured: true, compared: 19, changed: 19 }
        }
      };
      const host = document.querySelector('#calendarView .card') || document.getElementById('calendarView');
      let el = document.getElementById('cpsFakeHero');
      if (!el) { el = document.createElement('button'); el.id = 'cpsFakeHero'; host.appendChild(el); }
      window.__mlsCalHeroPull._paintVerdict(el, msg, 'ok', result);
      const s = document.getElementById('mlsCvHeroStatus');
      const det = s.querySelector('details.cvv-more');
      const head = s.querySelector('.cvv-head');
      return {
        head: head ? String(head.textContent || '') : null,
        detOpen: det ? !!det.open : null,
        summary: det ? String(det.querySelector('summary').textContent || '') : null,
        body: det ? String(det.querySelector('.cvv-body').textContent || '') : null,
        /* what is on screen with the fold CLOSED */
        openText: (function () {
          const clone = s.cloneNode(true);
          const d = clone.querySelector('details.cvv-more');
          if (d) d.parentNode.removeChild(d);
          return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
        })()
      };
    }, OWNER_MSG);
    measured.item2Open = verdict.openText;
    measured.item2OpenChars = String(verdict.openText.length);
    measured.item2FullChars = String(OWNER_MSG.length);
    eq(verdict.detOpen, false, 'the reconciliation detail is not folded away by default');
    eq(verdict.summary, 'Details', 'the fold is not called Details');
    eq(verdict.body, OWNER_MSG, 'the folded receipt is NOT the original message verbatim');
    eq(verdict.openText, 'Wed, Aug 19 is ready — all 19 patients pulled and verified.',
      `the open text is not the one plain sentence: "${verdict.openText}"`);
    eq((verdict.openText.match(/\./g) || []).length, 1, 'the open text is more than one sentence');
    /* keep every number reachable */
    for (const n of ['19', '3', '0']) {
      ok(verdict.body.indexOf(n) >= 0, `the number ${n} is no longer reachable in the folded receipt`);
    }
    /* the headline may never claim more than the receipt does */
    const shortfall = await page.evaluate(() => {
      const result = {
        ok: true, complete: true,
        scheduleReceipt: { expectedCount: 19, parsedCount: 19 },
        historyReceipt: {
          requested: 19, processed: 19, todayNoteFailures: 0,
          patients: Array.from({ length: 19 }, (_, i) => ({ id: 'syn-' + i, complete: i < 12 })),
          storeCensus: { measured: true, targets: 19, withContent: 9 }
        }
      };
      return window.__mlsCalHeroPull._verdictParts('Wed, Aug 19 is ready — 19 appointments reconciled.', result).head;
    });
    measured.item2Shortfall = shortfall;
    ok(!/all 19/.test(shortfall), `a shortfall was summarised as full coverage: "${shortfall}"`);
    ok(/12 of 19/.test(shortfall) && /Details/.test(shortfall), `a shortfall must name its own numbers and point at the fold: "${shortfall}"`);
    /* EVERY OTHER SHAPE the verdict can take. The first version of the headline
       said "14 of 14 patients pulled ... Open Details for the rest", which
       contradicts itself: the chart count was complete and the shortfall was
       somewhere else. A summary that can contradict itself is a summary nobody
       can trust, so each shape is pinned. */
    const shapes = await page.evaluate(() => {
      const vp = window.__mlsCalHeroPull._verdictParts;
      const full = (n) => Array.from({ length: n }, () => ({ complete: true }));
      return {
        censusOnly: vp('Wed, Aug 19 is ready — all 14 exact appointments were reconciled. Athena did not provide a row-to-provider link.',
          { ok: true, complete: true, appointmentCensusOnly: true, appointmentCensusReceipt: { rowCount: 14 }, scheduleReceipt: {} }),
        noHistory: vp('Wed, Aug 19 is ready — 14 appointments reconciled.',
          { ok: true, complete: true, scheduleReceipt: { parsedCount: 14 }, historyReceipt: {} }),
        noteFail: vp('Wed, Aug 19 is ready — 14 appointments reconciled, history read for 14 of 14. 2 pulled-day notes were not read.',
          { ok: true, complete: true, scheduleReceipt: { parsedCount: 14 }, historyReceipt: { requested: 14, todayNoteFailures: 2, patients: full(14) } }),
        censusUnmeasured: vp('Wed, Aug 19 is ready — 14 appointments reconciled. Chart content in MLS was not measured for this day.',
          { ok: true, complete: true, scheduleReceipt: { parsedCount: 14 }, historyReceipt: { requested: 14, patients: full(14), storeCensus: { measured: false, targets: 14, rows: 14 } } }),
        emptyDay: vp('Wed, Aug 19 was verified in Athena and has no appointments.', { ok: true, complete: true }),
        zeroRows: vp('Wed, Aug 19 is ready — 0 appointments reconciled.',
          { ok: true, complete: true, scheduleReceipt: { parsedCount: 0 }, historyReceipt: {} })
      };
    });
    measured.item2NoteFail = shapes.noteFail.head;
    eq(shapes.censusOnly.head, 'Wed, Aug 19 is ready — all 14 appointments are in MLS.', 'the provider-unknown census verdict is summarised wrongly');
    eq(shapes.noHistory.head, 'Wed, Aug 19 is ready — all 14 appointments are in MLS.', 'a pull with no history leg claims patients were verified');
    for (const k of ['noteFail', 'censusUnmeasured']) {
      const h = shapes[k].head;
      ok(!/verified\./.test(h), `${k}: an outstanding item was summarised as verified: "${h}"`);
      ok(!/14 of 14/.test(h), `${k}: the headline contradicts itself: "${h}"`);
      ok(/Open Details/.test(h), `${k}: the headline does not point at the fold: "${h}"`);
    }
    eq(shapes.emptyDay, null, 'a verified empty day is being folded');
    eq(shapes.zeroRows, null, 'a zero-row verdict is being folded');
    /* a refusal is not folded at all */
    const refusal = await page.evaluate(() => window.__mlsCalHeroPull._verdictParts('Sign in to MLS before pulling from Athena.', { ok: false }));
    eq(refusal, null, 'a refusal message is being folded');

    /* ================================================== ITEM 3 (runtime) */
    /* The bar is built from the painter's OWN shipped literal, extracted from
       the source, so this measures what ships rather than a copy of it. */
    const barHtml = (MC.match(/'(<div style="height:100%;width:3%;background:linear-gradient[^']*)'/) || [])[1];
    ok(barHtml, 'the pull-bar fill literal could not be extracted from the source');
    const bar = await page.evaluate((html) => {
      const host = document.querySelector('#calendarView .card') || document.getElementById('calendarView');
      let b = document.getElementById('mlsCvHeroBar');
      if (!b) {
        b = document.createElement('div');
        b.id = 'mlsCvHeroBar';
        b.style.cssText = 'flex-basis:100%;height:14px;border-radius:7px;background:#E3ECE7;overflow:hidden;display:none;margin-top:4px;';
        host.appendChild(b);
      }
      b.innerHTML = html;
      const fill = b.firstElementChild;
      /* the worst case for the old design: an early, mostly-empty bar */
      b.style.display = 'block';
      fill.style.width = '11%';
      fill.textContent = 'Histories 2/19 · 0m 38s';
      window.__mlsCalmBar.sweep();
      const cap = document.getElementById('mlsCvHeroBarCap');
      const cs = getComputedStyle(fill);
      const capCs = cap ? getComputedStyle(cap) : null;
      const br = b.getBoundingClientRect(), cr = cap ? cap.getBoundingClientRect() : null;
      /* what is actually painted behind the caption, sampled above the FILLED
         part of the bar and above the UNFILLED part of it */
      function bgAt(x, y) {
        let el = document.elementFromPoint(x, y);
        while (el) {
          const c = getComputedStyle(el).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
          el = el.parentElement;
        }
        return 'rgb(255, 255, 255)';
      }
      const capY = cr ? cr.top + cr.height / 2 : 0;
      return {
        capExists: !!cap,
        capText: cap ? String(cap.textContent || '') : null,
        capAlign: capCs ? capCs.textAlign : null,
        capColor: capCs ? capCs.color : null,
        capShown: capCs ? capCs.display !== 'none' : false,
        fillBg: cs.backgroundImage,
        fillFontPx: cs.fontSize,
        barAria: b.getAttribute('aria-hidden'),
        capAboveBar: cr ? Math.round(cr.bottom) <= Math.round(br.top) : null,
        overlapPx: cr ? Math.max(0, Math.min(cr.bottom, br.bottom) - Math.max(cr.top, br.top)) : null,
        trackBg: getComputedStyle(b).backgroundColor,
        /* the caption's own background, over the filled x-range and the
           unfilled x-range of the bar underneath it */
        bgOverFilled: bgAt(br.left + br.width * 0.05, capY),
        bgOverUnfilled: bgAt(br.left + br.width * 0.85, capY),
        fillPaint: (function () { const d = document.createElement('div'); d.style.background = 'linear-gradient(90deg,#2E6A4B,#3B7C5A)'; return d.style.background; })()
      };
    }, barHtml);

    ok(bar.capExists && bar.capShown, 'the bar caption was not mounted beside the bar');
    eq(bar.capText, 'Histories 2/19 · 0m 38s', 'the caption does not carry the painter\'s own text');
    eq(bar.capAlign, 'left', `the caption is not left-aligned (${bar.capAlign})`);
    eq(bar.fillFontPx, '0px', 'the caption is still painted on the fill');
    eq(bar.barAria, 'true', 'the bar is not aria-hidden, so the zero-size duplicate is still announced');
    eq(bar.capAboveBar, true, 'the caption is not clear of the bar');
    eq(bar.overlapPx, 0, `the caption still overlaps the bar by ${bar.overlapPx}px`);
    ok(/rgb\(46, 106, 75\)/.test(bar.fillBg), `the fill no longer starts at brand green: ${bar.fillBg}`);
    ok(/rgb\(59, 124, 90\)/.test(bar.fillBg), `the fill does not end at the app's calm green: ${bar.fillBg}`);
    ok(!/122, 92, 192/.test(bar.fillBg), `the fill is still violet: ${bar.fillBg}`);
    measured.item3Fill = bar.fillBg;

    const ink = parseRgb(bar.capColor);
    const overFilled = parseRgb(bar.bgOverFilled);
    const overUnfilled = parseRgb(bar.bgOverUnfilled);
    ok(ink && overFilled && overUnfilled, 'the caption colours could not be read back');
    const cFilled = contrast(ink, overFilled);
    const cUnfilled = contrast(ink, overUnfilled);
    measured.item3CaptionContrast = `over the filled segment ${cFilled}:1, over the unfilled segment ${cUnfilled}:1`;
    ok(cFilled >= 4.5, `caption contrast over the filled segment is ${cFilled}:1`);
    ok(cUnfilled >= 4.5, `caption contrast over the unfilled segment is ${cUnfilled}:1`);
    /* what the OLD design measured, for the record: white centred text landing
       on the unfilled track at 2 of 19. */
    const track = parseRgb(bar.trackBg) || [227, 236, 231];
    measured.item3Before = `white on the unfilled track was ${contrast([255, 255, 255], track)}:1`;
    ok(contrast([255, 255, 255], track) < 4.5, 'the before-state was not actually a contrast failure — the differential is wrong');

    /* ================================================== ITEM 1 (runtime) */
    /* Driven through the panel's OWN 900 ms render loop off the engine state
       it really reads (window.__mlsDayHistoryPull.state), not through the
       _renderDone seam — a card that only paints when a test calls it is not
       the card the doctor sees. Synthetic names only. */
    await page.evaluate(() => {
      const rows = Array.from({ length: 19 }, (_, i) => ({
        k: 'syn-' + i, name: ['Ada', 'Bo', 'Cy', 'Dee'][i % 4] + ' Sample', ok: true, dn: 'future-day'
      }));
      window.__cpsRowsDone = rows;
      window.__mlsDayHistoryPull = {
        state: { running: true, total: 19, done: 5, ok: 5, failed: 0, chartOnly: 0, current: 'opening the next chart', rows: rows.slice(0, 5) }
      };
    });
    await page.waitForTimeout(2200);
    await page.evaluate(() => { const f = document.getElementById('mlsPullProgFab'); if (f) f.click(); });
    await page.waitForTimeout(1400);
    await page.evaluate(() => {
      window.__mlsDayHistoryPull.state = {
        running: false, total: 19, done: 19, ok: 19, failed: 0, chartOnly: 0,
        finishedAt: Date.now(), rows: window.__cpsRowsDone,
        dayVerdict: { ok: 19, failed: 0, total: 19, complete: true, tnFailed: 0, tnRead: 0, tnNotYet: 0, tnFuture: 19 }
      };
    });
    await page.waitForTimeout(2200);
    const done = await page.evaluate(() => {
      const p = document.getElementById('mlsPullProgPanel');
      if (!p) return { built: false };
      const rows = p.querySelector('[data-pp="rows"]');
      const result = p.querySelector('[data-pp="current"]');
      return {
        built: true,
        rows: rows ? String(rows.textContent || '').replace(/\s+/g, ' ').trim() : '',
        result: result ? String(result.textContent || '').replace(/\s+/g, ' ').trim() : '',
        badRows: rows ? rows.querySelectorAll('.pp-bad').length : -1,
        waitRows: rows ? rows.querySelectorAll('.pp-wait').length : -1
      };
    });
    ok(done.built, 'the finished pull card could not be opened, so its wording is unmeasured');
    measured.item1Rows = done.rows.slice(0, 120);
    measured.item1Result = done.result;
    ok(/visit hasn.t happened yet/.test(done.rows), `the future-day rows do not carry the calm wording: "${done.rows.slice(0, 160)}"`);
    ok(!/not here/i.test(done.rows), `a future-day row still reads "not here": "${done.rows.slice(0, 160)}"`);
    ok(!/not read\b/i.test(done.rows), `a future-day row still reads "not read": "${done.rows.slice(0, 160)}"`);
    eq(done.badRows, 0, 'a future-day row is painted as a failure');
    eq(done.waitRows, 19, `all 19 future-day rows should be calm, ${done.waitRows} were`);
    ok(/notes: this day is in the future/.test(done.result), `the Result line does not state the future day: "${done.result}"`);
    eq(done.result.split('notes: this day is in the future').length - 1, 1, 'the Result line states the future day more than once');
    ok(/19 histories saved/.test(done.result), `the Result line lost its saved count: "${done.result}"`);

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
  console.log('1p-calendar-pull-surface: ' + checks + ' checks passed');
}, (err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
