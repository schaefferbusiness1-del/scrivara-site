'use strict';
/* One corner nudge at a time (onenudge-1.0.0, b1305). Measured on a signed-in
   desktop shell with the bottom taskbar: the taskbar's one-time question
   ("Taskbar covering your work? Move it to the side...") and the "Use MLS on
   your phone" QR card were on screen together in the bottom-right corner; the
   card covered the question's text and the question covered "Go to Patients".
   The question wins (it is about the doctor's work; the card is an offer): the
   card waits, or steps aside if it got there first, and returns once the
   question is answered. Real Chrome, signed-in shell booted the way
   1p-clunky-contract boots it. Nothing leaves 127.0.0.1. */
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
  try {
    const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await page.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });

    const state = () => page.evaluate(() => ({
      nudge: !!document.querySelector('#mlsDockNudge.on'),
      card: !!document.getElementById('mlsGetPhoneCard'),
      side: document.documentElement.getAttribute('data-mls-dock-band') || ''
    }));

    /* 1. let the card's 12s floor pass, then do what a doctor does - press
       something - which wakes the taskbar's owner and its one-time question.
       From then on the two are never on screen together. */
    await page.waitForTimeout(14000);
    const before = await state();
    await page.click('#mlsDock button[data-dest="visit"]'); await page.waitForTimeout(300);
    const seen = [];
    for (let i = 0; i < 8; i++) { seen.push(await state()); await page.waitForTimeout(500); }
    const asked = seen.some((s) => s.nudge);
    assert.ok(asked || seen.every((s) => s.side !== 'bottom'), 'the bottom taskbar still asks its question: ' + JSON.stringify({ before, seen: seen.slice(-3) }));
    assert.ok(seen.every((s) => !(s.nudge && s.card)), 'the question and the phone card are never on screen together: ' + JSON.stringify(seen));

    /* 2. answered, the card may come back - and still never beside the question */
    if (asked) {
      await page.click('#mlsDockNudgeNo'); await page.waitForTimeout(500);
      let back = false;
      for (let i = 0; i < 8 && !back; i++) { await page.waitForTimeout(1000); const s = await state(); assert.ok(!(s.nudge && s.card), 'together after answering'); back = s.card; }
      const eligible = await page.evaluate(() => !!(window.__mlsGetPhone && window.__mlsGetPhone.eligible && window.__mlsGetPhone.eligible()));
      assert.ok(back || !eligible, 'once the question is answered the phone card is offered again');
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS one corner nudge at a time: the taskbar question and the phone card are never on screen together, the question wins, and the card returns once it is answered');
  } finally { await b.close(); srv.close(); }
});
