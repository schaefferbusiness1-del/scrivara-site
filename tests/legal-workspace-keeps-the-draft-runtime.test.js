'use strict';
/* The Legal / IME workspace keeps the doctor's draft (legalfix-1.0.0, b1320).
   Found by the Legal / surgeon-page hunt on the signed-in 1p shell:
   - Close, Escape (even while typing in a field) and any report-type button
     (even the one already selected) threw a generated, doctor-edited draft
     away with no warning;
   - "Open Settings" in the letterhead warning opened Settings UNDER the
     full-screen sheet;
   - a 9th local file was dropped with its refusal written into a collapsed
     card, and the records card still said "no local files added";
   - every export was named and titled an IME and carried the internal "1p"
     tag; the Activity chip sat over the sheet and took its clicks;
   - in the sample workspace the Local records card could not be opened.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
for (const f of ['1p-feat_mls_legalpack.js', 'feat_mls_legalpack.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.ok(!/MLS_1p_Legal|'1p Legal \/ IME/.test(src), f + ': no export or notice carries the internal "1p" tag');
}
const PREVIEW = fs.readFileSync(path.join(ROOT, 'public-preview-runtime.js'), 'utf8');
assert.ok(/#mlsP1LegalRoot \.p1l-disclose/.test(PREVIEW), 'the sample lets a Legal card header open its card');
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
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
    });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.evaluate(() => { try { bkUser = { role: 'doctor', email: 'ui-harness@mlsscribe.test' }; } catch (e) {} window.bkUser = { role: 'doctor', email: 'ui-harness@mlsscribe.test' }; window.__mlsPatientLock.switchAsDoctor('syn-0'); });
    await pg.evaluate(() => { const L = window.__mlsP1LegalLoader; if (L && typeof L.ensure === 'function') L.ensure(); });
    await pg.waitForFunction(() => !!window.__mlsP1LegalPack, null, { timeout: 30000 });
    const opened = await pg.evaluate(async () => { const ok = window.__mlsP1LegalPack.open(); await new Promise((r) => setTimeout(r, 800)); return { ok, root: !!document.getElementById('mlsP1LegalRoot') }; });
    assert.ok(opened.root, 'the Legal / IME workspace opens for a clinician: ' + JSON.stringify(opened));

    /* bind (step 1) if the workspace asks for it, then pick a report */
    await pg.evaluate(async () => {
      const bind = [...document.querySelectorAll('#mlsP1LegalRoot button')].find((x) => /^Use this patient|^Bind|Choose .*patient/i.test(x.textContent.trim()) && !x.disabled);
      if (bind) { bind.click(); await new Promise((r) => setTimeout(r, 500)); }
      const rec = document.querySelector('#mlsP1LegalRoot .p1l-report[data-report-type="records"]'); if (rec) rec.click();
      await new Promise((r) => setTimeout(r, 300));
    });
    const picked = await pg.evaluate(() => window.__mlsP1LegalPack.state());
    assert.strictEqual(picked.reportType, 'records', 'a report type can be picked: ' + JSON.stringify(picked));

    /* a draft on screen (as after Generate plus an edit) */
    const setDraft = () => pg.evaluate(() => { const d = document.getElementById('mlsP1LegalDraft'); d.hidden = false; d.value = 'RECORDS REVIEW\nDoctor edit: keep this line.'; });
    const askUp = () => pg.evaluate(() => !!document.getElementById('mlsP1LegalAsk'));
    const rootUp = () => pg.evaluate(() => !!document.getElementById('mlsP1LegalRoot'));
    await setDraft();

    /* 1. re-picking the selected type changes nothing */
    await pg.evaluate(() => document.querySelector('#mlsP1LegalRoot .p1l-report[data-report-type="records"]').click());
    assert.strictEqual(await pg.evaluate(() => document.getElementById('mlsP1LegalDraft').value), 'RECORDS REVIEW\nDoctor edit: keep this line.', 're-picking the selected report keeps the draft');
    assert.strictEqual(await askUp(), false, 'and asks nothing');

    /* 2. Close asks; Keep keeps */
    await pg.evaluate(() => document.getElementById('mlsP1LegalClose').click());
    assert.strictEqual(await askUp(), true, 'Close asks before discarding the draft');
    await pg.evaluate(() => [...document.querySelectorAll('#mlsP1LegalAsk button')].find((x) => /Keep/.test(x.textContent)).click());
    assert.deepStrictEqual([await askUp(), await rootUp()], [false, true], 'Keep the draft keeps the workspace open');
    assert.strictEqual(await pg.evaluate(() => document.activeElement && document.activeElement.id), 'mlsP1LegalClose', 'focus goes back to Close');

    /* 3. Escape asks; Escape on the question keeps */
    const focused = await pg.evaluate(() => { const f = [...document.querySelectorAll('#mlsP1LegalRoot input:not([type=file]), #mlsP1LegalRoot textarea')].find((x) => x.getClientRects().length && !x.disabled); if (f) f.focus(); return !!f && document.activeElement === f; });
    assert.ok(focused, 'a field in the workspace takes focus');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    assert.strictEqual(await askUp(), true, 'Escape asks before discarding the draft');
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(100);
    assert.deepStrictEqual([await askUp(), await rootUp()], [false, true], 'Escape on the question keeps the workspace');

    /* 4. another report type asks; Discard and switch switches */
    await pg.evaluate(() => document.querySelector('#mlsP1LegalRoot .p1l-report[data-report-type="narrative"]').click());
    assert.strictEqual(await askUp(), true, 'another report type asks first');
    assert.strictEqual((await pg.evaluate(() => window.__mlsP1LegalPack.state())).reportType, 'records', 'nothing switched yet');
    await pg.evaluate(() => [...document.querySelectorAll('#mlsP1LegalAsk button')].find((x) => /Discard/.test(x.textContent)).click());
    await pg.waitForTimeout(200);
    assert.strictEqual((await pg.evaluate(() => window.__mlsP1LegalPack.state())).reportType, 'narrative', 'Discard and switch switches');

    /* 5. a refused 9th file is said in the records card */
    const files = Array.from({ length: 9 }, (_, i) => ({ name: 'rec' + i + '.txt', mimeType: 'text/plain', buffer: Buffer.from('Record ' + i) }));
    const input = await pg.$('#mlsP1LegalFile');
    assert.ok(input, 'the local records picker exists');
    await input.setInputFiles(files); await pg.waitForTimeout(800);
    const msg = await pg.evaluate(() => (document.getElementById('mlsP1LegalSourcesMsg') || {}).textContent || '');
    assert.match(msg, /Only 8 local files/, 'the refused file is said where the files are: ' + msg);

    /* 6. the Activity chip does not sit on the sheet's controls */
    const chip = await pg.evaluate(() => {
      const t = document.getElementById('mlsTrayBtn'); if (!t || !t.getClientRects().length) return null;
      const tr = t.getBoundingClientRect();
      const hits = [...document.querySelectorAll('#mlsP1LegalRoot button, #mlsP1LegalRoot input, #mlsP1LegalRoot textarea')].filter((e) => e.getClientRects().length).filter((e) => { const r = e.getBoundingClientRect(); return r.left < tr.right && tr.left < r.right && r.top < tr.bottom && tr.top < r.bottom; });
      return { right: Math.round(tr.right), covers: hits.map((e) => e.id || e.textContent.trim().slice(0, 20)) };
    });
    if (chip) assert.deepStrictEqual(chip.covers, [], 'the Activity chip covers no control in the sheet: ' + JSON.stringify(chip));

    /* 7. Close with no draft closes at once */
    await pg.evaluate(() => { const d = document.getElementById('mlsP1LegalDraft'); if (d) { d.value = ''; d.hidden = true; } document.getElementById('mlsP1LegalClose').click(); });
    await pg.waitForTimeout(200);
    assert.deepStrictEqual([await askUp(), await rootUp()], [false, false], 'with no draft, Close closes without asking');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS legal workspace keeps the draft: re-picking a type keeps it, Close / Escape / another type ask first, a refused file is said in the records card, the Activity chip covers none of the sheet, and exports carry no internal tag');
  } finally { await b.close(); srv.close(); }
});
