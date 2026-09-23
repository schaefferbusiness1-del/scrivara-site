'use strict';
/* The public booking page books the time it shows, can be used with a
   keyboard, and refuses an impossible date of birth (pagesfix-1.0.0, 2026-09-23).
   Found by the patient-page hunt on booking.html:
   - a slow answer for the previous date overwrote the new date's times, and
     tapping one booked a time never offered for the date in the field;
   - the times were divs Tab never reached, while the server requires a time;
   - "Please pick an available time, or clear the date." told the patient the
     date was optional, then the server said "Please choose an appointment time.";
   - a date of birth of 2031-05-05 or 20255-01-01 was sent as-is;
   - the earliest date was today in UTC, so at 8:30 PM Pacific today could not
     be picked; times that have passed ({taken, past}) read as "booked".
   Real Chromium; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'b'.repeat(40);
const INFO = { ok: true, practice: { name: 'Synthetic Spine Clinic', google_business_url: '' }, doctors: [{ id: 7, name: 'Dr. Ada Test', specialty: 'Spine' }],
  availability: { tz: 'America/Los_Angeles', slotMin: 30, days: [1, 2, 3, 4, 5] } };
/* 8:30 PM Wednesday 2026-09-23 in Los Angeles = 03:30 UTC on the 24th. */
const NOW = new Date('2026-09-24T03:30:00Z');
const SLOTS = {
  '2026-09-23': [{ time: '09:00', taken: true, past: true }, { time: '10:00', taken: true, past: true }, { time: '20:00', taken: true, past: true }, { time: '21:00', taken: false }],
  '2026-10-05': [{ time: '09:00', taken: false }, { time: '09:30', taken: true }, { time: '10:00', taken: false }],
  '2026-10-06': [{ time: '14:00', taken: false }, { time: '14:30', taken: false }],
};
const VIEWPORTS = { desktop: { viewport: { width: 1400, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  /* book(body) answers a booking POST; slowDate answers late for that date. */
  const open = async (vp, opts) => {
    opts = opts || {};
    const ctx = await b.newContext(Object.assign({ timezoneId: 'America/Los_Angeles' }, VIEWPORTS[vp]));
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(vp + ': ' + String(e.message).slice(0, 160)));
    await pg.clock.setFixedTime(NOW);
    const posts = [], slotCalls = [];
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.route('https://scrivara-backend.onrender.com/**', async (route) => {
      const u = new URL(route.request().url()), send = (s, j) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(j) });
      if (/\/slots$/.test(u.pathname)) {
        const d = u.searchParams.get('date'); slotCalls.push(d);
        if (d === opts.slowDate) await new Promise((res) => setTimeout(res, 1200));
        return send(200, { ok: true, tz: INFO.availability.tz, slotMin: 30, slots: SLOTS[d] || [] });
      }
      if (/\/book$/.test(u.pathname)) {
        const body = JSON.parse(route.request().postData()); posts.push(body);
        const h = opts.book ? opts.book(body) : [200, { ok: true, patient_token: 'p'.repeat(48) }];
        return send(h[0], h[1]);
      }
      if (u.pathname === '/api/schedule/public/' + TOKEN) return send(200, INFO);
      return send(404, {});
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/booking.html?token=' + TOKEN, { waitUntil: 'load' });
    await pg.waitForFunction(() => !document.getElementById('formCard').classList.contains('hide'), null, { timeout: 15000 });
    return { ctx, pg, posts, slotCalls };
  };
  const pickDate = async (pg, d) => { await pg.fill('#bookDate', d); await pg.waitForFunction(() => !/Loading times/.test(document.getElementById('slotGrid').textContent)); };
  const text = (pg, s) => pg.evaluate((s) => { const e = document.querySelector(s); return e && !e.classList.contains('hide') ? e.textContent.trim() : ''; }, s);
  const slotNames = (pg) => pg.$$eval('#slotGrid .slot', (els) => els.map((e) => e.textContent.trim()));
  try {
    for (const vp of ['desktop', 'phone']) {
      /* 1. a slow answer for the previous date does not replace the new date's times */
      {
        const { ctx, pg, posts } = await open(vp, { slowDate: '2026-10-05' });
        await pg.fill('#name', 'Pat Testpatient'); await pg.fill('#phone', '2155550111');
        await pg.fill('#bookDate', '2026-10-05'); await pg.waitForTimeout(100);
        await pickDate(pg, '2026-10-06');
        await pg.waitForTimeout(1600);
        assert.deepStrictEqual(await slotNames(pg), ['2:00 PM', '2:30 PM'], vp + ': after the late answer for Oct 5 the list still shows Oct 6 times: ' + JSON.stringify(await slotNames(pg)));
        await pg.click('#slotGrid .slot >> nth=0'); await pg.click('#submitBtn');
        await pg.waitForFunction(() => !document.getElementById('done').classList.contains('hide'));
        assert.deepStrictEqual({ date: posts[0].date, time: posts[0].time }, { date: '2026-10-06', time: '14:00' }, vp + ': the booked time is one offered for the date in the field');
        await ctx.close();
      }
      /* 2. the times are reachable and chosen with the keyboard, and the choice is announced */
      {
        const { ctx, pg, posts } = await open(vp);
        await pg.fill('#name', 'Pat Testpatient');
        await pickDate(pg, '2026-10-05');
        await pg.focus('#bookDate');
        let reached = null;
        for (let i = 0; i < 8 && !reached; i++) {
          await pg.keyboard.press('Tab');
          reached = await pg.evaluate(() => { const a = document.activeElement; return a && a.classList.contains('slot') ? { tag: a.tagName, text: a.textContent.trim() } : null; });
        }
        assert.ok(reached, vp + ': Tab from the date reaches an appointment time');
        assert.strictEqual(reached.text, '9:00 AM', vp + ': the first open time is the first stop');
        const ring = await pg.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2; });
        assert.ok(ring, vp + ': a focused time shows a visible focus ring');
        await pg.keyboard.press('Tab');
        assert.strictEqual(await pg.evaluate(() => document.activeElement.textContent.trim()), '10:00 AM', vp + ': a booked time is skipped by Tab');
        await pg.keyboard.press('Space');
        const state = await pg.$$eval('#slotGrid .slot', (els) => els.map((e) => e.textContent.trim() + '=' + (e.getAttribute('aria-pressed') || e.getAttribute('aria-checked'))));
        assert.deepStrictEqual(state, ['9:00 AM=false', '9:30 AM=false', '10:00 AM=true'], vp + ': Space chooses the time and only that time is marked chosen: ' + state.join(', '));
        await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Enter');
        const state2 = await pg.$$eval('#slotGrid .slot', (els) => els.map((e) => e.getAttribute('aria-pressed') || e.getAttribute('aria-checked')));
        assert.deepStrictEqual(state2, ['true', 'false', 'false'], vp + ': Enter chooses a time too (and does not send the form)');
        assert.strictEqual(posts.length, 0, vp + ': choosing a time with Enter does not submit');
        if (vp === 'phone') {
          const lay = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
            small: [...document.querySelectorAll('#slotGrid .slot')].filter((e) => e.getBoundingClientRect().height < 44).length }));
          assert.ok(lay.sw <= lay.cw && lay.small === 0, vp + ': times fit the phone and stay thumb-sized: ' + JSON.stringify(lay));
        }
        await pg.click('#submitBtn');
        await pg.waitForFunction(() => !document.getElementById('done').classList.contains('hide'));
        assert.strictEqual(posts[0].time, '09:00', vp + ': the keyboard-chosen time is the one booked');
        await ctx.close();
      }
      /* 3. a date and a time are required, and the page says so plainly */
      {
        const { ctx, pg, posts } = await open(vp, { book: () => [400, { error: 'Please choose an appointment time.' }] });
        const req = await pg.evaluate(() => ({ label: document.querySelector('label[for="bookDate"]').textContent, aria: document.getElementById('bookDate').getAttribute('aria-required') || (document.getElementById('bookDate').required ? 'true' : '') }));
        assert.ok(/\*|required/i.test(req.label) || req.aria === 'true', vp + ': the date is marked required: ' + JSON.stringify(req));
        await pg.fill('#name', 'Pat Testpatient');
        await pg.click('#submitBtn'); await pg.waitForTimeout(300);
        const noDate = await text(pg, '#formErr');
        assert.strictEqual(posts.length, 0, vp + ': a request with no date is not sent');
        assert.match(noDate, /date/i, vp + ': with no date the page asks for a date: ' + noDate);
        await pickDate(pg, '2026-10-05');
        await pg.click('#submitBtn'); await pg.waitForTimeout(300);
        const noTime = await text(pg, '#formErr');
        assert.ok(/time/i.test(noTime) && !/clear the date|optional/i.test(noTime), vp + ': with a date but no time the page asks for a time and never says the date is optional: ' + noTime);
        assert.strictEqual(posts.length, 0, vp + ': a request with no time is not sent');
        await ctx.close();
      }
      /* 4. an impossible date of birth is refused next to the field; so is the server's refusal */
      {
        const { ctx, pg, posts } = await open(vp, { book: (body) => body.dob === '1985-03-14' ? [400, { error: 'Please check the date of birth.', field: 'dob' }] : [200, { ok: true }] });
        await pg.fill('#name', 'Pat Testpatient');
        await pickDate(pg, '2026-10-05'); await pg.click('#slotGrid .slot >> nth=0');
        for (const dob of ['2031-05-05', '20255-01-01', '1850-06-01']) {
          await pg.fill('#dob', dob);
          await pg.click('#submitBtn'); await pg.waitForTimeout(300);
          assert.strictEqual(posts.length, 0, vp + ': a date of birth of ' + dob + ' is not sent');
          const near = await pg.evaluate(() => { const d = document.getElementById('dob'), ids = (d.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            const m = ids.map((id) => document.getElementById(id)).find((e) => e && !e.classList.contains('hide') && e.textContent.trim());
            return m ? { t: m.textContent.trim(), nextToField: d.parentElement.contains(m), invalid: d.getAttribute('aria-invalid') } : null; });
          assert.ok(near && near.nextToField && /date of birth/i.test(near.t) && near.invalid === 'true', vp + ': ' + dob + ' gets a clear message next to the field: ' + JSON.stringify(near));
        }
        /* a two-digit year is named as such (Chrome stores 03/14/85 as 0085-03-14) */
        await pg.fill('#dob', '0085-03-14'); await pg.click('#submitBtn'); await pg.waitForTimeout(200);
        const twoDigit = await pg.evaluate(() => document.getElementById('dobErr').textContent);
        assert.match(twoDigit, /four-digit year/, vp + ': a two-digit year is named, not called a day that does not exist: ' + twoDigit);
        /* no error appears while the year is still being typed (change fires per keystroke) */
        await pg.evaluate(() => { const d = document.getElementById('dob'); d.value = ''; document.getElementById('dobErr').classList.add('hide'); d.focus(); d.value = '0001-03-14'; d.dispatchEvent(new Event('change', { bubbles: true })); });
        assert.strictEqual(await pg.evaluate(() => document.getElementById('dobErr').classList.contains('hide')), true, vp + ': no error is shown mid-typing');
        await pg.fill('#dob', '1985-03-14');
        await pg.click('#submitBtn'); await pg.waitForTimeout(400);
        assert.strictEqual(posts.length, 1, vp + ': a real date of birth is sent');
        const fromServer = await pg.evaluate(() => { const e = document.getElementById('dobErr'); return e && !e.classList.contains('hide') ? e.textContent.trim() : ''; });
        assert.match(fromServer, /Please check the date of birth/, vp + ': the server refusing the date of birth is shown next to that field');
        await ctx.close();
      }
      /* 5. today is pickable at 8:30 PM Pacific; times that have passed read as passed, not booked */
      {
        const { ctx, pg } = await open(vp);
        const min = await pg.$eval('#bookDate', (e) => e.min);
        assert.strictEqual(min, '2026-09-23', vp + ': at 8:30 PM on Sep 23 in Los Angeles the earliest date is Sep 23, not the UTC date: ' + min);
        await pickDate(pg, '2026-09-23');
        const slots = await pg.$$eval('#slotGrid .slot', (els) => els.map((e) => ({ t: e.textContent.trim(), name: (e.getAttribute('aria-label') || e.title || e.textContent).trim(), off: e.disabled || e.getAttribute('aria-disabled') === 'true' })));
        const past = slots.filter((s) => s.t !== '9:00 PM');
        assert.ok(past.length === 3 && past.every((s) => s.off && /passed/i.test(s.name) && !/booked/i.test(s.name)), vp + ': passed times are unavailable and say they have passed, not that they are booked: ' + JSON.stringify(past));
        assert.ok(slots.some((s) => s.t === '9:00 PM' && !s.off), vp + ': the open time tonight is offered');
        assert.ok(!/booked/i.test(await text(pg, '#slotMsg')), vp + ': the note under the times does not call passed times booked');
        await ctx.close();
      }
      /* 6. a time that passed while the form was open: the server's 409 reloads the times */
      {
        const { ctx, pg, slotCalls } = await open(vp, { book: () => [409, { ok: false, error: 'That time has already passed. Please pick a later time.' }] });
        await pg.fill('#name', 'Pat Testpatient');
        await pickDate(pg, '2026-10-05'); await pg.click('#slotGrid .slot >> nth=0');
        await pg.click('#submitBtn'); await pg.waitForTimeout(500);
        assert.match(await text(pg, '#formErr'), /already passed/, vp + ': the server reason is shown');
        assert.strictEqual(slotCalls.length, 2, vp + ': the times are fetched again after "already passed"');
        await ctx.close();
      }
    }
    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS booking offered times and date of birth: a late answer for an old date is ignored, times are keyboard buttons with a focus ring and aria-pressed, a date and time are required and said plainly, an impossible date of birth (and the server refusing one) is shown next to the field, today is pickable in the evening, and passed times read as passed (desktop + phone)');
  } finally { await b.close(); srv.close(); }
});
