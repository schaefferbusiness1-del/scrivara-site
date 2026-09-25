'use strict';
/* h9-1.1.0 (2026-09-25): the homepage demo form says which field to fix when
   the server refuses the email address.

   The email input is type=email, which accepts a dotless address such as
   lee@clinic. POST /api/demo refuses it (it needs a full domain) and says so
   with error "invalid_email". The page used to turn every refusal into
   "Something went wrong sending the form", so the visitor could not tell that
   the address was the problem. Red at site f57f2aaf.

   The backend is stubbed with page.route, with the same answer the backend
   gives (tests/legal-public-tells-the-truth.test.js in the backend pins it).
   Nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://scrivara-backend.onrender.com';
let checks = 0;

const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];

  /* One visitor sends the form; the stubbed backend answers `answer`. */
  async function send(viewport, email, answer) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const posted = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.origin !== API) return route.abort('blockedbyclient');
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (u.pathname !== '/api/demo') return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
      posted.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({ status: answer[0], headers: cors, contentType: 'application/json', body: JSON.stringify(answer[1]) });
    });
    try {
      await page.goto(base + '/index.html#demo', { waitUntil: 'load' });
      await page.fill('#d-name', 'Dr. Lee');
      await page.fill('#d-email', email);
      await page.click('#demo button[type=submit]');
      await page.waitForFunction(() => { const s = document.getElementById('demoStatus'); return s && s.textContent && s.textContent !== 'Sending…'; }, null, { timeout: 10000 });
      return {
        posted,
        status: (await page.locator('#demoStatus').innerText()).replace(/\s+/g, ' '),
        name: await page.inputValue('#d-name'),
        email: await page.inputValue('#d-email'),
        focused: await page.evaluate(() => document.activeElement && document.activeElement.id),
      };
    } finally { await ctx.close(); }
  }

  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      /* the refused dotless address: the page names the email field */
      const refused = await send(viewport, 'lee@clinic', [400, { ok: false, error: 'invalid_email', message: 'Enter a full email address, such as you@clinic.com.' }]);
      assert.strictEqual(refused.posted.length, 1, 'the browser did not send the dotless address, so this case proves nothing');
      assert.strictEqual(refused.posted[0].email, 'lee@clinic');
      assert.ok(/email address/i.test(refused.status) && /you@clinic\.com/.test(refused.status),
        `${viewport.width}px: a refused email address is not named: "${refused.status}"`);
      assert.ok(!/something went wrong/i.test(refused.status), `${viewport.width}px: a refused email address reads as a failure to send: "${refused.status}"`);
      assert.strictEqual(refused.name, 'Dr. Lee', 'what was typed was cleared');
      assert.strictEqual(refused.email, 'lee@clinic', 'the address to fix was cleared');
      assert.strictEqual(refused.focused, 'd-email', 'the email field is not ready to fix');
      checks += 3;

      /* a delivery failure is still a failure to send, with the fallback address */
      const failed = await send(viewport, 'lee@clinic.example.test', [503, { ok: false, error: 'demo_delivery_failed', message: 'The demo request could not be delivered. Please try again.' }]);
      assert.ok(/something went wrong/i.test(failed.status) && /michael@mlsscribe\.com/.test(failed.status),
        `${viewport.width}px: a delivery failure lost its fallback: "${failed.status}"`);
      checks++;
    }
    assert.deepStrictEqual(errors, [], 'page errors: ' + errors.join(' | '));
    console.log(`PASS homepage demo form names a refused email: ${checks} checks — a dotless address the server refuses is named as the field to fix, what was typed is kept, and a delivery failure still offers the email fallback`);
  } catch (e) {
    console.error(e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
});
