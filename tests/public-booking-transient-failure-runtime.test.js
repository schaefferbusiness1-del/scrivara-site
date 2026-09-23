'use strict';

/* A public booking link is dead only when the server says 404.
 *
 * booking.html showed "This booking link isn't active" for ANY failed load: a
 * cold backend, a 502 from the gateway, a rate limit, a dropped connection.
 * The patient read that as "this office stopped booking" and went elsewhere.
 * It now shows a retry card for those, and Try again reaches the form without
 * reopening the link (the token is stripped from the address bar on load).
 * The submit path used to parse a plain-text 429 as JSON and blame the
 * patient's connection; it now says to wait a minute. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'synthetic-booking-token-0001';

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const visible = (page, id) => page.evaluate((x) => !document.getElementById(x).classList.contains('hide'), id);

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    let settings = 'down';
    let book = 'limited';
    await page.route('https://scrivara-backend.onrender.com/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === `/api/schedule/public/${TOKEN}`) {
        if (settings === 'down') return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' });
        if (settings === 'dead') return route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' });
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, practice: { name: 'Synthetic Spine Clinic' }, doctors: [], availability: { days: [1, 2, 3], tz: 'UTC', slotMin: 30 } }) });
      }
      if (u.pathname === `/api/schedule/public/${TOKEN}/slots`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, slots: [{ time: '09:00', taken: false }] }) });
      if (u.pathname === `/api/schedule/public/${TOKEN}/book`) {
        if (book === 'limited') return route.fulfill({ status: 429, contentType: 'text/html', body: 'Too many requests, please try again later.' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.fulfill({ status: 404, body: '' });
    });

    await page.goto(`${origin}/booking.html?token=${TOKEN}`);
    await page.waitForFunction(() => document.getElementById('loading').classList.contains('hide'));
    assert.strictEqual(await visible(page, 'trouble'), true, 'a 502 on load must show the retry card');
    assert.strictEqual(await visible(page, 'inactive'), false, 'a 502 on load must not call the link inactive');
    assert.ok(!page.url().includes(TOKEN), 'the token is stripped from the address bar, so a reload cannot recover it');

    settings = 'up';
    await page.click('#troubleRetry');
    await page.waitForFunction(() => !document.getElementById('formCard').classList.contains('hide'));
    assert.strictEqual(await page.textContent('#practiceBrand'), 'Synthetic Spine Clinic', 'Try again must load the form in place');

    await page.fill('#name', 'Synthetic Patient');
    await page.fill('#bookDate', '2030-01-07'); await page.click('#slotGrid .slot');
    await page.click('#submitBtn');
    await page.waitForFunction(() => !document.getElementById('formErr').classList.contains('hide'));
    const limited = await page.textContent('#formErr');
    assert.match(limited, /Too many tries/, 'a plain-text 429 must say to wait, not blame the connection: ' + limited);
    assert.strictEqual(await page.isDisabled('#submitBtn'), false, 'the submit button must come back after a 429');

    book = 'ok';
    await page.click('#submitBtn');
    await page.waitForFunction(() => !document.getElementById('done').classList.contains('hide'));

    const dead = await browser.newPage();
    await dead.route('https://scrivara-backend.onrender.com/**', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' }));
    await dead.goto(`${origin}/booking.html?token=${TOKEN}`);
    await dead.waitForFunction(() => !document.getElementById('inactive').classList.contains('hide'));
    assert.strictEqual(await visible(dead, 'trouble'), false, 'a real 404 is a dead link, not a connection problem');
    console.log('PASS public booking transient failure: 502 on load shows Try again (which loads the form in place), 404 alone means inactive, and a plain-text 429 on submit says to wait');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
