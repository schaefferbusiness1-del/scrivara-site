'use strict';
/* The surgeon's "Wrong template?" re-fit tells the truth (refitfit-1.0.0).
   The backend now refuses a rewrite that does not follow the picked template's
   headings (422 OPNOTE_REFIT_NOT_FITTED) and keeps the note as it was. The page
   used to answer every non-409 refusal with "That did not go through. Try again
   in a moment." - wrong for a rewrite that went through and was judged - and
   its picker never showed which template the note was written from, because
   the job never carried templateId. Real Chrome on /opnotes.html, backend
   stubbed, synthetic data only. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const K = 'b'.repeat(64);
const NOTE = 'OPERATIVE REPORT\nPATIENT: ZZ Synthetic Surgeon Patient\nPROCEDURE: ZZ synthetic knee scope\nTOURNIQUET TIME: [TOURNIQUET TIME]';
const REFUSAL = 'The rewrite did not follow that template (missing SIDE), so your note has been kept exactly as it was. Try again, or edit it here.';

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    const refits = [];
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' };
    const json = (route, status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
      const u = new URL(req.url());
      if (!/scrivara-backend\.onrender\.com$/.test(u.hostname)) return route.fulfill({ status: 503, body: 'offline' });
      const p = u.pathname;
      if (p === '/api/client/opnotes/session') return json(route, 200, { needsSignIn: false, client: { name: 'ZZ Synthetic Surgeon' }, hasMlsAccount: false });
      if (p === '/api/client/opnotes/templates') return json(route, 200, { templates: [{ id: 'tpl-knee', name: 'ZZ Knee Scope' }, { id: 'tpl-house', name: 'ZZ House Knee Scope' }] });
      if (p === '/api/client/opnotes/jobs') return json(route, 200, { jobs: [{ id: 'job-1', title: 'ZZ Synthetic Scope', status: 'open', blankCount: 1, filledCount: 0 }] });
      if (p === '/api/client/opnotes/jobs/job-1') return json(route, 200, { job: { id: 'job-1', title: 'ZZ Synthetic Scope', status: 'open', version: 1, noteText: NOTE, blanks: [{ key: 'tourniquet_time', label: 'Tourniquet time', value: '' }], templateId: 'tpl-house' } });
      if (p === '/api/client/opnotes/jobs/job-1/retemplate') {
        refits.push(JSON.parse(req.postData() || '{}'));
        return json(route, 422, { error: { code: 'OPNOTE_REFIT_NOT_FITTED', message: REFUSAL } });
      }
      return json(route, 404, { error: { code: 'NOT_STUBBED', message: 'not stubbed' } });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + '/opnotes.html#k=' + K, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.getElementById('opnRefitPick') && !!document.getElementById('opnNote') && document.getElementById('opnNote').value.length > 0, null, { timeout: 30000 });

    const picked = await page.inputValue('#opnRefitPick');
    assert.strictEqual(picked, 'tpl-house', 'the picker shows the template the note was written from');

    await page.selectOption('#opnRefitPick', 'tpl-knee');
    await page.click('#opnRefitGo');
    await page.waitForFunction(() => { const m = document.getElementById('refitMsg'); return m && !/takes a few seconds/.test(m.textContent) && m.textContent.trim().length > 0; }, null, { timeout: 15000 });
    const after = await page.evaluate(() => ({ msg: document.getElementById('refitMsg').textContent, note: document.getElementById('opnNote').value, undo: document.getElementById('opnRefitUndo').className }));
    assert.strictEqual(refits.length, 1, 'one re-fit request');
    assert.deepStrictEqual(refits[0], { templateId: 'tpl-knee', expectedVersion: 1 }, 'the request names the picked template and version');
    assert.match(after.msg, /did not follow that template/, 'the refusal says what happened: ' + after.msg);
    assert.match(after.msg, /missing SIDE/, 'and names what was missing: ' + after.msg);
    assert.doesNotMatch(after.msg, /did not go through|Someone else changed/, 'not a transport error or a conflict: ' + after.msg);
    assert.strictEqual(after.note, NOTE, 'the note on the page is unchanged');
    assert.match(after.undo, /\bhide\b/, 'no "Put it back" for a rewrite that never happened');
    assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS opnotes.html re-fit refusal: the picker shows the note\'s template, and a rewrite that does not follow the picked template is reported as such with the note unchanged');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
