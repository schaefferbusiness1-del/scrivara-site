'use strict';
/* portaluser-1.1.0 + portalinactive-1.1.0 + portalload-1.1.0 (review of the
   portal hunt fixes). Real Chrome; the API is stubbed with page.route; nothing
   leaves 127.0.0.1.
     1. The first-time password box closed on save and named the sign-in only
        in the chat behind it. A family member sharing an email has a handle
        they were never told: the box now shows it and closes on their tap.
     2. A practice with no access answers chat with 503 PRACTICE_INACTIVE and
        a line naming who to call; the portal said "try again".
     3. A records load refused as signed-out put the sign-in screen back with
        no word of why. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const HISTORY = {
  patient: { name: 'Jordan Testpatient', dob: '1979-05-14' },
  medications: [], problems: [], appointments: [], visits: [],
  practice: { name: 'Test Spine Practice', phone: '(215) 555-0100' }
};
const INACTIVE = 'The chat is not available right now. Please call your care team at (215) 555-0100. Your records are still here.';
let checks = 0;
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  async function page(opts) {
    const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const u = new URL(route.request().url());
      const origin = route.request().headers()['origin'] || '*';
      const hdr = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
      const send = (s, j) => route.fulfill({ status: s, contentType: 'application/json', headers: hdr, body: JSON.stringify(j) });
      if (u.pathname === '/api/patient/auth/login') return send(200, { ok: true, session: 'S'.repeat(40), mustSetPassword: false });
      if (u.pathname === '/api/patient/auth/set-password') return send(200, { ok: true, signInName: 'mls.testspine.kid2' });
      if (u.pathname === '/api/patient/me') return send(200, { ok: true, practice: HISTORY.practice });
      if (u.pathname === '/api/patient/history') return opts.historyAuth ? send(401, { error: 'Sign in.' }) : send(200, HISTORY);
      if (u.pathname === '/api/patient/chat') return send(503, { error: INACTIVE, code: 'PRACTICE_INACTIVE' });
      if (u.pathname === '/api/patient/requests') return send(200, { ok: true, requests: [] });
      if (u.pathname === '/api/patient/tele/eligibility') return send(200, { ok: true, eligible: false });
      return route.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/patient-portal.html' + (opts.hash || ''), { waitUntil: 'load' });
    return pg;
  }
  try {
    /* 1. the setup box names the handle and waits for the patient */
    const pg = await page({ hash: '#session=' + 'S'.repeat(40) + '&setup=1' });
    await pg.waitForSelector('#mlsPwSetup #pwsGo', { timeout: 15000 });
    assert.doesNotMatch(await pg.textContent('#mlsPwSetup'), /with your email and date of birth/, 'the box still says the email is the sign-in'); checks++;
    await pg.fill('#pwsP1', 'Child-Pass-123'); await pg.fill('#pwsP2', 'Child-Pass-123');
    await pg.click('#pwsGo');
    await pg.waitForSelector('#pwsWho', { timeout: 10000 });
    assert.strictEqual((await pg.textContent('#pwsWho')).trim(), 'mls.testspine.kid2', 'the box does not name the sign-in'); checks++;
    assert.match(await pg.textContent('#mlsPwSetup'), /shared/, 'a shared-email handle is not explained'); checks++;
    assert.strictEqual(await pg.evaluate(() => document.activeElement && document.activeElement.id), 'pwsDone', 'the confirm button does not have the focus'); checks++;
    await pg.waitForTimeout(400);
    assert.ok(await pg.$('#mlsPwSetup'), 'the box closed before the patient read the sign-in'); checks++;
    await pg.click('#pwsDone');
    assert.strictEqual(await pg.$('#mlsPwSetup'), null, 'the box did not close'); checks++;
    assert.ok((await pg.evaluate(() => Array.from(document.querySelectorAll('.msg.sys')).map((m) => m.textContent).join(' '))).includes('mls.testspine.kid2'), 'the sign-in is not kept in the chat'); checks++;

    /* 2. chat names who to call when the practice has no access */
    await pg.fill('#q', 'When is my next appointment?');
    await pg.press('#q', 'Enter');
    await pg.waitForFunction((t) => Array.from(document.querySelectorAll('.msg.ai')).some((m) => m.textContent === t), INACTIVE, { timeout: 10000 }).catch(() => {});
    const last = await pg.evaluate(() => { const a = document.querySelectorAll('.msg.ai'); return a.length ? a[a.length - 1].textContent : ''; });
    assert.strictEqual(last, INACTIVE, 'the practice-inactive answer was not shown: ' + last); checks++;
    await pg.context().close();

    /* 3. a signed-out records load says why the sign-in screen is back */
    const p3 = await page({ historyAuth: true });
    await p3.fill('#u', 'jordan@example.com'); await p3.fill('#p', 'correct-horse'); await p3.fill('#d', '1979-05-14');
    await p3.click('#loginBtn');
    await p3.waitForFunction(() => { const e = document.getElementById('loginErr'); return e && !e.classList.contains('hide') && /session ended/i.test(e.textContent); }, null, { timeout: 10000 }).catch(() => {});
    assert.match(await p3.textContent('#loginErr'), /Your session ended/, 'the sign-in screen came back with no reason'); checks++;
    assert.ok(await p3.isVisible('#login'), 'the sign-in screen is not shown'); checks++;
    await p3.context().close();

    assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join(' | ')); checks++;
    console.log('PASS patient portal names the sign-in and who to call: ' + checks + ' checks - the password box shows the sign-in name (a shared-email handle explained) and closes on the patient\'s tap; a practice with no access says who to call; a signed-out load says the session ended');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await b.close(); srv.close(); }
});
