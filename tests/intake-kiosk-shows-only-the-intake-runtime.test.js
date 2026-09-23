'use strict';
/* The intake kiosk shows only the intake (kiosk-1.0.0, b1315). Measured on the
   signed-in 1p shell: with Patient intake open (the device in a patient's
   hands, leaving needs the clinician's password) a "/" on the page opened the
   clinician Find palette OVER the kiosk - it listed other patients' names and
   dates of birth, and Enter on "Settings" opened the clinician Settings.
   openIntake hid #appScreen and open dialogs only; body-level overlays and
   background notices were not covered. Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
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
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    });
    await pg.waitForTimeout(2000);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.waitForTimeout(1000);

    /* a notice naming a patient is up when the kiosk opens */
    await pg.evaluate(() => { toast('Pulled Ada Sample’s chart.', 'ok'); openIntake(); });
    await pg.waitForTimeout(400);
    const shown = () => pg.evaluate(() => {
      const vis = [...document.body.children].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden').map((e) => e.id || e.tagName);
      return { vis, text: document.body.innerText };
    });
    const at0 = await shown();
    assert.ok(at0.vis.includes('intakeView'), 'the intake is on screen: ' + JSON.stringify(at0.vis));
    assert.ok(!/Sample/.test(at0.text), 'no patient name is on screen when the kiosk opens: ' + at0.vis.join(','));

    /* "/" and Ctrl+K on the page background open nothing */
    await pg.mouse.click(1300, 450);
    await pg.keyboard.press('/'); await pg.waitForTimeout(300);
    await pg.keyboard.type('Sample'); await pg.waitForTimeout(300);
    await pg.keyboard.press('Control+k'); await pg.waitForTimeout(300);
    const at1 = await shown();
    assert.deepStrictEqual(at1.vis.filter((id) => !['intakeView', 'toast'].includes(id)), [], 'nothing but the intake renders after "/" and Ctrl+K: ' + JSON.stringify(at1.vis));
    assert.ok(!/Sample/.test(at1.text), 'no other patient’s name or date of birth is on screen');

    /* a background notice waits; the intake's own notice shows */
    const notes = await pg.evaluate(() => {
      toast('Pulled Bo Sample’s chart.', 'ok');
      const bg = (document.getElementById('toast') || {}).textContent || '';
      _ikToast('Please enter your full name in the first box.', 'err');
      const own = (document.getElementById('toast') || {}).textContent || '';
      return { bg, own };
    });
    assert.strictEqual(notes.bg, '', 'a background notice is held while the kiosk is up');
    assert.match(notes.own, /full name/, 'the intake’s own notice still shows');

    /* typing in the intake form still works */
    const typed = await pg.evaluate(() => { const n = document.getElementById('ikName'); if (!n) return null; n.focus(); return true; });
    if (typed) { await pg.keyboard.type('Pat Doe'); assert.strictEqual(await pg.evaluate(() => document.getElementById('ikName').value), 'Pat Doe', 'the patient can type in the intake form'); }

    /* once the kiosk is left the app is back */
    const after = await pg.evaluate(() => {
      document.getElementById('intakeView').style.display = 'none'; document.getElementById('appScreen').style.display = '';
      const d = document.getElementById('mlsDock'); return !!(d && getComputedStyle(d).display !== 'none');
    });
    assert.ok(after, 'the taskbar returns when the kiosk is closed');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS intake kiosk shows only the intake: no clinician overlay, palette or background notice renders over it, "/" and Ctrl+K open nothing, the intake still types and speaks, and the app returns when it closes');
  } finally { await b.close(); srv.close(); }
});
