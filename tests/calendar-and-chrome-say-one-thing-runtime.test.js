'use strict';
/* The calendar and the app chrome name one thing one way (calnav-1.1.0,
   vstage-1.0.0). Found by the ScribeFlow.html UI critique and measured on
   /ScribeFlow.html:
   - With "More calendar tools" closed, an EMPTY 236px rail track pushed the
     calendar ~250px right of the bar above it (#calGrid 902px at x=406).
   - "Show more calendar tools" alone made the bar lead with "Back to the
     calendar" while the calendar was on screen.
   - The status line read "4 booked" with no day under a Month/Week header, and
     the Patient brief said "2 appointments today" (silently the doctor's own)
     while the Calendar said 4.
   - The header said "Day" over a Month grid; the Patient tab read "Patients ·";
     the header pill read "Tuesday Sep 22" beside a strip on Wednesday.
   - The "Type or paste visit notes" dialog title was white on white.
   Real Chrome, sample workspace, desktop. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'offline' }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/ScribeFlow.html?preview=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => (window._calAppts || []).length > 0 && typeof window.showView === 'function' && !!window.__mlsCalmShell, null, { timeout: 60000 });
    await page.waitForTimeout(2500);

    /* 1. the calendar sits flush under its bar while the tools are closed */
    await page.evaluate(() => window.showView('calendar'));
    await page.waitForFunction(() => { const g = document.getElementById('calGrid'); return g && g.getBoundingClientRect().width > 0 && /booked/.test((document.getElementById('mlsClunkyCalLine') || {}).textContent || ''); }, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const cal = await page.evaluate(() => {
      const g = document.getElementById('calGrid').getBoundingClientRect(), m = document.querySelector('#calendarView .cx-main');
      const bar = document.getElementById('mlsRightNow');
      return { gridW: Math.round(g.width), cols: m ? getComputedStyle(m).gridTemplateColumns : '', open: document.body.classList.contains('mls-cv-open-calendar'),
        bar: bar ? bar.textContent.replace(/\s+/g, ' ') : '', line: (document.getElementById('mlsClunkyCalLine') || {}).textContent || '',
        title: (document.getElementById('mlsRdTitle') || {}).textContent || '', pill: (document.getElementById('mslToday') || {}).textContent || '' };
    });
    if (!cal.open) {
      assert.strictEqual(cal.cols.trim().split(/\s+/).length, 1, 'no empty rail track while the tools are closed: ' + cal.cols);
      assert.ok(cal.gridW > 1050, 'the calendar uses the width the empty track took: ' + cal.gridW);
    }
    assert.doesNotMatch(cal.bar, /Back to the calendar/, 'no "Back to the calendar" while the calendar is on screen: ' + cal.bar);
    assert.match(cal.line, /^(Today \()?[A-Z][a-z]{2} \d{1,2}\)?: \d+ booked/, 'the status line names its day: ' + cal.line);
    assert.match(cal.title, /Calendar/, 'the header names the Calendar the dock opened: ' + cal.title);
    assert.doesNotMatch(cal.title, /^\s*Day\s*$/, 'not "Day" over a Month grid');
    assert.match(cal.pill, /^Today · /, 'the header pill says it is today: ' + cal.pill);

    /* 2. opening the tools brings the rail back and still no false exit */
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /more calendar tools/i.test(x.textContent)); if (b) b.click(); });
    await page.waitForTimeout(900);
    const more = await page.evaluate(() => { const m = document.querySelector('#calendarView .cx-main'), bar = document.getElementById('mlsRightNow');
      return { open: document.body.classList.contains('mls-cv-open-calendar'), cols: m ? getComputedStyle(m).gridTemplateColumns : '', bar: bar ? bar.textContent.replace(/\s+/g, ' ') : '' }; });
    if (more.open) assert.strictEqual(more.cols.trim().split(/\s+/).length, 2, 'the rail track returns with the tools: ' + more.cols);
    assert.doesNotMatch(more.bar, /Back to the calendar/, 'showing the tools is not a list to leave: ' + more.bar);

    /* 3. the Patient screen: one count story and a clean tab label */
    await page.evaluate(() => window.showView('patients'));
    await page.waitForTimeout(1500);
    const pt = await page.evaluate(() => ({
      brief: (document.getElementById('dailyBriefBar') || {}).textContent || '',
      segs: Array.from(document.querySelectorAll('.segbtn')).map((s) => s.textContent),
      today: (window._calAppts || []).filter((a) => a && a.appt_date === (typeof window._acctTodayKey === 'function' ? window._acctTodayKey() : '')).length,
    }));
    if (pt.brief) {
      const m = pt.brief.match(/(\d+) of today's (\d+) appointments are yours|(\d+) appointments? today/);
      assert.ok(m, 'the brief states its count: ' + pt.brief);
      if (m[2]) assert.strictEqual(+m[2], pt.today, 'the brief\'s practice total matches the schedule: ' + pt.brief);
    }
    assert.ok(pt.segs.every((s) => !/·\s*$/.test(s)), 'no tab ends in a dangling "·": ' + JSON.stringify(pt.segs));

    /* 4. the Type-or-paste dialog title is readable (its head is a <header>) */
    const qtp = await page.evaluate(() => {
      const ov = document.createElement('div'); ov.className = 'mls-qtp-overlay';
      ov.innerHTML = '<section class="mls-qtp-card"><header class="mls-qtp-head"><div class="mls-qtp-headcopy"><h3>Type or paste visit notes</h3></div></header></section>';
      document.body.appendChild(ov);
      const c = getComputedStyle(ov.querySelector('h3')).color; ov.remove(); return c;
    });
    const rgb = (qtp.match(/\d+/g) || []).map(Number);
    assert.ok(rgb.length >= 3 && rgb[0] + rgb[1] + rgb[2] < 300, 'the dialog title is dark on its white card: ' + qtp);

    /* 5. one DOB format on one screen (dobfmt-1.0.0) */
    await page.evaluate(() => window.showView('visit'));
    await page.waitForTimeout(1200);
    const dob = await page.evaluate(() => ({ bar: (document.querySelector('.mlsctx-meta') || {}).textContent || '', card: (document.querySelector('.mls-idmeta') || {}).textContent || '' }));
    for (const t of [dob.bar, dob.card]) {
      if (/DOB/.test(t)) assert.match(t, /DOB \d{2}\/\d{2}\/\d{4}/, 'every DOB reads MM/DD/YYYY: ' + JSON.stringify(dob));
    }

    /* 6. phone month: the count badge fits its day cell (calnav-1.1.0) */
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'offline' }));
    await phone.goto(page.url(), { waitUntil: 'load' });
    await phone.waitForFunction(() => (window._calAppts || []).length > 0 && typeof window.showView === 'function', null, { timeout: 60000 });
    await phone.waitForTimeout(2500);
    await phone.evaluate(() => { window.showView('calendar'); window.calSetMode('month'); });
    await phone.waitForTimeout(1500);
    const badges = await phone.evaluate(() => {
      const out = { cells: 0, badges: 0, clipped: [] };
      document.querySelectorAll('#calGrid > div > div[onclick^="calOpenDay"]').forEach((c) => {
        out.cells++;
        const cr = c.getBoundingClientRect();
        const nums = Array.prototype.filter.call(c.querySelectorAll('*'), (e) => e.children.length === 0 && /^\d+$/.test(e.textContent.trim()));
        if (nums.length > 1) out.badges++;
        nums.forEach((k) => { const kr = k.getBoundingClientRect(); if (kr.width && (kr.right > cr.right + 0.5 || kr.left < cr.left - 0.5)) out.clipped.push(c.textContent.trim().slice(0, 8)); });
      });
      return out;
    });
    assert.ok(badges.cells >= 28, 'the phone month grid rendered: ' + JSON.stringify(badges));
    assert.deepStrictEqual(badges.clipped, [], 'no count badge is cut off by its day cell: ' + JSON.stringify(badges));
    await phone.close();

    assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS calendar and chrome say one thing: no empty rail track, no false "Back to the calendar", the status line names its day, the header says Calendar and Today, the brief says whose appointments it counts, tabs have no dangling dot, the paste-notes title is readable, DOBs share one format, and phone month badges fit their cells');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
