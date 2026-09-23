'use strict';
/* The surgeon op-note page keeps what the surgeon typed (opnfix-1.0.0, b1319).
   Found by the Legal / surgeon-page hunt on opnotes.html:
   - opening another note from the list silently dropped the typed values;
   - a notes list that failed to load read "Nothing waiting for you right now";
     a note that failed to open said nothing (or blamed the note below);
   - a sign-in in the middle of a save lost the typed values;
   - Enter in the code field did nothing, and a refused code request offered
     "Send another code".
   Real Chrome; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const LINK = 'a'.repeat(64);
const job = (id, title, blankKey) => ({ id, title, status: 'drafted', version: 1, blankCount: 1, filledCount: 0,
  noteText: 'PROCEDURE: ' + title + '\nESTIMATED BLOOD LOSS: [EBL]', blanks: [{ key: blankKey, label: 'ESTIMATED BLOOD LOSS', state: 'open', value: '' }] });

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (api) => {
    const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.route(/\/api\/client\/opnotes\//, async (route) => {
      const req = route.request(), u = new URL(req.url()), key = u.pathname.replace(/^.*\/api\/client\/opnotes/, '') + ' ' + req.method();
      const h = api(key, req.postData() ? JSON.parse(req.postData()) : null);
      if (!h) return route.fulfill({ status: 404, body: '{}' });
      return route.fulfill({ status: h[0], contentType: 'application/json', body: JSON.stringify(h[1]) });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/opnotes.html#k=' + LINK, { waitUntil: 'load' });
    await pg.waitForFunction(() => window.opnReady && true, null, { timeout: 20000 });
    await pg.evaluate(() => window.opnReady);
    await pg.waitForTimeout(300);
    return pg;
  };
  try {
    /* 1. opening another note saves what was typed first */
    const saves = [];
    const A = job('oj_a', 'Right knee arthroscopy', 'ebl_a'), B = job('oj_b', 'Left L4-5 TFESI', 'ebl_b');
    const pg = await open((key, body) => {
      if (key === '/session GET') return [200, { client: { name: 'Dr Test' } }];
      if (key === '/templates GET') return [200, { templates: [] }];
      if (key === '/jobs GET') return [200, { jobs: [A, B] }];
      if (key === '/jobs/oj_a GET') return [200, { job: A }];
      if (key === '/jobs/oj_b GET') return [200, { job: B }];
      if (key === '/jobs/oj_a/save POST') { saves.push(body); return [200, { job: Object.assign({}, A, { version: 2, noteText: A.noteText.replace('[EBL]', body.blanks[0].value), blanks: [{ key: 'ebl_a', label: 'ESTIMATED BLOOD LOSS', state: 'placed', value: body.blanks[0].value }], filledCount: 1 }) }]; }
      return null;
    });
    assert.ok(await pg.$('#opnB_ebl_a'), 'the first unfinished note opens by itself');
    await pg.fill('#opnB_ebl_a', '150 mL');
    await pg.click('button.jobrow:has-text("Left L4-5 TFESI")'); await pg.waitForTimeout(500);
    assert.strictEqual(saves.length, 1, 'the typed value is saved before the other note opens');
    assert.strictEqual(saves[0].blanks[0].value, '150 mL');
    assert.ok(await pg.$('#opnB_ebl_b'), 'then the other note opens');

    /* 2. a list that failed to load says so and offers a retry */
    let listOk = false;
    const pg2 = await open((key) => {
      if (key === '/session GET') return [200, { client: { name: 'Dr Test' } }];
      if (key === '/templates GET') return [500, { error: {} }];
      if (key === '/jobs GET') return listOk ? [200, { jobs: [] }] : [500, { error: {} }];
      return null;
    });
    const failed = await pg2.evaluate(() => ({ list: document.getElementById('list').textContent, tpl: document.getElementById('tplList').textContent }));
    assert.ok(!/Nothing waiting/.test(failed.list) && /could not be loaded/.test(failed.list), 'a failed list is not "nothing waiting": ' + failed.list);
    assert.match(failed.tpl, /could not be loaded/, 'failed templates say so');
    listOk = true; await pg2.click('#list button:has-text("Try again")'); await pg2.waitForTimeout(300);
    assert.match(await pg2.evaluate(() => document.getElementById('list').textContent), /Nothing waiting/, 'Try again reloads the list');

    /* 3. a note that fails to open says so by the list */
    const pg3 = await open((key) => {
      if (key === '/session GET') return [200, { client: { name: 'Dr Test' } }];
      if (key === '/templates GET') return [200, { templates: [] }];
      if (key === '/jobs GET') return [200, { jobs: [A] }];
      if (key === '/jobs/oj_a GET') return [500, { error: {} }];
      return null;
    });
    const said = await pg3.evaluate(() => { const m = document.getElementById('listMsg'); return m && !m.classList.contains('hide') ? m.textContent : ''; });
    assert.match(said, /did not open/, 'a note that fails to open is said next to the list: ' + said);

    /* 4. a sign-in in the middle of a save keeps what was typed; Enter signs in */
    let signedIn = false, codeRefused = true;
    const pg4 = await open((key) => {
      if (key === '/session GET') return [200, { client: { name: 'Dr Test' } }];
      if (key === '/templates GET') return [200, { templates: [] }];
      if (key === '/jobs GET') return [200, { jobs: [A] }];
      if (key === '/jobs/oj_a GET') return [200, { job: A }];
      if (key === '/jobs/oj_a/save POST') return signedIn ? [200, { job: A }] : [401, { error: { code: 'OPNOTE_SIGNIN_REQUIRED' } }];
      if (key === '/code POST') return codeRefused ? [429, { error: { message: 'Wait a minute before asking for another code.' } }] : [200, { sent: true }];
      if (key === '/verify POST') { signedIn = true; return [200, { session: 's1', client: { name: 'Dr Test' } }]; }
      return null;
    });
    await pg4.fill('#opnB_ebl_a', '220 mL');
    await pg4.click('#jobCard button:has-text("Save")'); await pg4.waitForTimeout(400);
    await pg4.click('#opnCodeBtn'); await pg4.waitForTimeout(300);
    assert.strictEqual((await pg4.textContent('#opnCodeBtn')).trim(), 'Email me a code', 'a refused code request does not offer "another" code');
    codeRefused = false;
    await pg4.click('#opnCodeBtn'); await pg4.waitForTimeout(300);
    await pg4.fill('#opnCode', '123456'); await pg4.press('#opnCode', 'Enter'); await pg4.waitForTimeout(800);
    const back = await pg4.evaluate(() => ({ v: (document.getElementById('opnB_ebl_a') || {}).value, msg: (document.getElementById('jobMsg') || {}).textContent }));
    assert.strictEqual(back.v, '220 mL', 'after signing in again the typed value is back: ' + JSON.stringify(back));
    assert.match(back.msg || '', /press Save/, 'and the page says it still needs saving');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS opnotes keeps what the surgeon typed: opening another note saves first, failed loads say so with a retry, a failed open is said by the list, a mid-save sign-in keeps the values, and Enter signs in');
  } finally { await b.close(); srv.close(); }
});
