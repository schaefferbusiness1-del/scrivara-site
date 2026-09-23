'use strict';
/* The calendar keeps its place (calfix-1.0.0, b1311). Measured on
   /ScribeFlow.html?preview=1:
   - Week and Month marked the BROWSER's today; the Day view, the brief and
     the schedule use the account's today (practice timezone), so a doctor
     whose machine sat in another zone saw two different "todays";
   - a Week header day in the next month opened Day while Month/Year stayed
     on the old month;
   - Jump-to-month left the old selected day highlighted and the reference
     date behind;
   - the first and last hour labels were half cut off;
   - the appointment peek wrote its ids bare (a sample id is a string, so
     Start visit threw), was not a dialog, had an x no keyboard could reach,
     ignored Escape, and opened at the top-left corner from the keyboard;
   - a roomed patient was still offered "Check in";
   - on a phone the 44px tap floor stacked short Day blocks over each other,
     and the phone agenda's name and sub-line ran together on one line.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const url = 'http://127.0.0.1:' + srv.address().port + '/ScribeFlow.html?preview=1';
  /* 01:30 in New York (the account's default zone) is still the evening
     before in Los Angeles, where this browser is. */
  const NOW = new Date('2026-09-23T01:30:00-04:00');
  const open = async (opts) => {
    const ctx = await b.newContext(Object.assign({ timezoneId: 'America/Los_Angeles' }, opts));
    const pg = await ctx.newPage();
    await pg.clock.install({ time: NOW });
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto(url);
    await pg.waitForFunction(() => (window._calAppts || []).length > 0 && typeof window.showView === 'function', null, { timeout: 60000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => showView('calendar')); await pg.waitForTimeout(1000);
    return pg;
  };
  try {
    const pg = await open({ viewport: { width: 1400, height: 900 } });

    /* 1. Month and Week mark the account's today */
    const today = await pg.evaluate(() => {
      window._calSelDay = null; calSetMode('month'); _calYear = 2026; _calMonth = 8; _calRenderMonth();
      const cells = [...document.querySelectorAll('#calGrid [onclick^="calOpenDay"]')];
      const marked = cells.filter((c) => /1px solid (rgb\(46, 106, 75\)|#2E6A4B)/i.test(c.getAttribute('style') || '')).map((c) => (c.getAttribute('onclick').match(/\d{4}-\d{2}-\d{2}/) || [''])[0]);
      _calRefDate = _acctTodayKey(); calSetMode('week');
      const wk = [...document.querySelectorAll('#calGrid [title="Open this day"]')].filter((h) => /46, 106, 75|#2E6A4B/i.test(h.getAttribute('style') || '')).map((h) => h.textContent);
      return { acct: _acctTodayKey(), marked, wk };
    });
    assert.strictEqual(today.acct, '2026-09-23', 'the account today is the practice-zone date');
    assert.deepStrictEqual(today.marked, ['2026-09-23'], 'Month marks the account today, not the browser date: ' + JSON.stringify(today));
    assert.deepStrictEqual(today.wk, ['Wed 23'], 'Week marks the account today: ' + JSON.stringify(today));

    /* 2. a Week header day in the next month moves Month with it */
    const wkHead = await pg.evaluate(() => {
      _calRefDate = '2026-09-29'; calSetMode('week');
      const h = [...document.querySelectorAll('#calGrid [title="Open this day"]')].find((x) => /Thu 1$/.test(x.textContent.trim()));
      if (!h) return null; h.click();
      return { ref: _calRefDate, y: _calYear, m: _calMonth, mode: _calMode };
    });
    assert.deepStrictEqual(wkHead, { ref: '2026-10-01', y: 2026, m: 9, mode: 'day' }, 'opening Oct 1 from the Week header puts Month on October too');

    /* 3. Jump-to-month moves the reference date and forgets the old selection */
    const jumped = await pg.evaluate(() => { calSetMode('month'); window._calSelDay = '2026-10-01'; calJump('2026-12'); return { ref: _calRefDate, sel: window._calSelDay, m: _calMonth }; });
    assert.deepStrictEqual(jumped, { ref: '2026-12-01', sel: null, m: 11 }, 'Jump to December lands on December with nothing stale selected');

    /* 4. hour labels stay inside the Day timeline */
    const labels = await pg.evaluate(() => {
      _calRefDate = '2026-09-23'; _calSyncFromRef(); calSetMode('day');
      const box = document.querySelector('#calGrid > div[onclick^="_calGridClick"]'); if (!box) return null;
      const r = box.getBoundingClientRect();
      const ls = [...box.children].filter((e) => /\d (AM|PM)$/.test(e.textContent.trim()) && !e.hasAttribute('data-appt'));
      return { n: ls.length, out: ls.filter((e) => { const q = e.getBoundingClientRect(); return q.top < r.top - 0.5 || q.bottom > r.bottom + 0.5; }).map((e) => e.textContent) };
    });
    assert.ok(labels && labels.n >= 2, 'the Day timeline has hour labels');
    assert.deepStrictEqual(labels.out, [], 'no hour label is cut off at the top or bottom of the timeline');

    /* 5. the peek is a dialog the keyboard can use */
    await pg.waitForFunction(() => document.querySelectorAll('#calGrid [data-appt]').length > 0, null, { timeout: 15000 });
    await pg.evaluate(() => document.querySelector('#calGrid [data-appt]').focus());
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
    const peek = await pg.evaluate(() => {
      const p = document.getElementById('calApptPeek'); if (!p) return null;
      const r = p.getBoundingClientRect(), a = document.activeElement;
      return { role: p.getAttribute('role'), label: p.getAttribute('aria-label') || '', focusIn: p.contains(a), xBtn: !!p.querySelector('button[aria-label="Close"]'),
        corner: r.left <= 8.5 && r.top <= 8.5, bare: [...p.querySelectorAll('[onclick]')].map((e) => e.getAttribute('onclick')).filter((s) => /\((preview-[\w-]+)[,)]/.test(s)) };
    });
    assert.ok(peek, 'Enter on an appointment opens its peek');
    assert.strictEqual(peek.role, 'dialog'); assert.ok(peek.label.length > 0, 'the peek names its patient');
    assert.ok(peek.focusIn, 'focus moves into the peek');
    assert.ok(peek.xBtn, 'the x is a real button');
    assert.ok(!peek.corner, 'a keyboard-opened peek sits by its appointment, not in the corner');
    assert.deepStrictEqual(peek.bare, [], 'every id in the peek is quoted');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
    const back = await pg.evaluate(() => ({ gone: !document.getElementById('calApptPeek'), onAppt: !!(document.activeElement && document.activeElement.hasAttribute('data-appt')) }));
    assert.deepStrictEqual(back, { gone: true, onAppt: true }, 'Escape closes the peek and returns focus to the appointment');

    /* 6. Start visit from the peek works with a sample (string) id */
    const started = await pg.evaluate(async () => {
      const e = document.querySelector('#calGrid [data-appt]'); e.click(); await new Promise((r) => setTimeout(r, 300));
      const s = [...document.querySelectorAll('#calApptPeek button')].find((x) => /Start visit/.test(x.textContent));
      let threw = ''; const before = window.onerror; window.onerror = (m) => { threw = String(m); };
      try { s && s.click(); } catch (x) { threw = String(x); }
      await new Promise((r) => setTimeout(r, 300)); window.onerror = before;
      return { had: !!s, threw };
    });
    assert.ok(started.had, 'the peek offers Start visit');
    assert.ok(!/is not defined|Unexpected/.test(started.threw), 'Start visit with a sample id does not throw: ' + started.threw);

    /* 7. a roomed patient is not offered Check in */
    const roomed = await pg.evaluate(async () => {
      const a = (window._calAppts || [])[0]; const was = a.status; a.status = 'roomed';
      const key = a.appt_date || String(a.start_at || '').slice(0, 10);
      calOpenDay(key); calApptInfo(a.id);
      const box = document.getElementById('calApptEdit_' + a.id);
      const txt = box ? box.textContent : ''; a.status = was;
      return { box: !!box, checkIn: /Check in/.test(txt) };
    });
    assert.deepStrictEqual(roomed, { box: true, checkIn: false }, 'Details for a roomed patient offers no Check in');

    /* 8. phone: short Day blocks do not stack, the agenda rows break their lines */
    const ph = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
    await ph.evaluate(() => { calSetMode('day'); _calRefDate = _acctTodayKey(); _calSyncFromRef(); renderCalendar(); });
    /* the exact-layout pass places blocks on its own tick; under load give it time */
    await ph.waitForFunction(() => [...document.querySelectorAll('#calGrid [data-appt]')].some((e) => e.getBoundingClientRect().height > 0), null, { timeout: 20000 }).catch(() => {});
    const phone = await ph.evaluate(async () => {
      const bl = [...document.querySelectorAll('#calGrid [data-appt]')].filter((e) => e.getBoundingClientRect().height > 0);
      const minH = bl.map((e) => getComputedStyle(e).minHeight);
      return { blocks: bl.length, floor: minH.filter((m) => m === '44px').length };
    });
    assert.ok(phone.blocks > 0, 'the phone Day view shows its appointments');
    assert.strictEqual(phone.floor, 0, 'no timed Day block carries the 44px floor on a phone: ' + JSON.stringify(phone));
    /* the phone agenda (feat_mls_phone_ui.js) is not installed on this page;
       its two row lines are SPANs, so pin that each is a block line */
    const phCss = fs.readFileSync(path.join(ROOT, 'feat_mls_phone_ui.js'), 'utf8');
    assert.ok(/\.ph3-row \.ph3-nm\{display:block;/.test(phCss) && /\.ph3-row \.ph3-sub2\{display:block;/.test(phCss), 'the phone agenda name and sub-line are block lines, so each ellipsizes and the sub-line sits under the name');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS calendar keeps its place: Week and Month mark the account today, a Week header day moves Month with it, Jump forgets a stale selection, hour labels are whole, the peek is a keyboard dialog with quoted ids, roomed patients are not re-checked-in, and phone blocks do not stack');
  } finally { await b.close(); srv.close(); }
});
