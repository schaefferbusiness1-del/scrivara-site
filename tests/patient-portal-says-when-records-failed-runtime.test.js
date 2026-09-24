'use strict';
/* portalload-1.0.0: when /api/patient/history failed (500, 404, a cold-start
   502 HTML page), the portal read the error as data and told a patient with
   medications "No medications / problems / appointments / visits on file",
   with nothing saying the load failed. A failure now says so - never "on
   file" - and Try again loads the records. Real Chrome; the API is stubbed
   with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const HISTORY = {
  patient: { name: 'Jordan Testpatient', dob: '1979-05-14', mrn: 'T-100' },
  medications: [{ name: 'Gabapentin 300 mg' }], problems: [{ name: 'Lumbar radiculopathy' }],
  appointments: [], visits: [{ date: '2026-09-01', visit_type: 'Office visit', summary: 'Seen for back pain.' }],
  practice: { name: 'Test Spine Practice', phone: '(215) 555-0100' }
};
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
  const state = async (pg) => pg.evaluate(() => ({
    counts: ['cMeds', 'cProb', 'cAppt', 'cVis'].map((id) => document.getElementById(id).textContent),
    empties: ['medsEmpty', 'probEmpty', 'apptEmpty', 'visEmpty'].map((id) => { const e = document.getElementById(id); return e.classList.contains('hide') ? '' : e.textContent; }),
    meds: document.querySelectorAll('#meds li').length,
    retry: !!document.getElementById('recRetry') && document.getElementById('recRetry').innerText
  }));
  try {
    for (const mode of [{ name: 'password sign-in, 500 JSON', status: 500, body: JSON.stringify({ error: 'history failed' }), type: 'application/json' },
      { name: 'invite-link session, 502 HTML (cold start)', status: 502, body: '<html><body>Bad gateway</body></html>', type: 'text/html', link: true }]) {
      const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
      pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
      let historyCalls = 0;
      await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
        const u = new URL(route.request().url());
        const origin = route.request().headers()['origin'] || '*';
        const hdr = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
        const send = (s, j) => route.fulfill({ status: s, contentType: 'application/json', headers: hdr, body: JSON.stringify(j) });
        if (u.pathname === '/api/patient/auth/login') return send(200, { ok: true, session: 'S'.repeat(40), mustSetPassword: false });
        const signedIn = /Bearer S{40}/.test(route.request().headers()['authorization'] || '');
        if (u.pathname === '/api/patient/me') return signedIn ? send(200, { ok: true, practice: HISTORY.practice }) : send(401, { error: 'Sign in.' });
        if (u.pathname === '/api/patient/history') { historyCalls++; return historyCalls === 1 ? route.fulfill({ status: mode.status, contentType: mode.type, headers: hdr, body: mode.body }) : send(200, HISTORY); }
        if (u.pathname === '/api/patient/requests') return send(200, { ok: true, requests: [] });
        if (u.pathname === '/api/patient/tele/eligibility') return send(200, { ok: true, eligible: false });
        return route.fulfill({ status: 503, body: 'x' });
      });
      const url = 'http://127.0.0.1:' + srv.address().port + '/patient-portal.html' + (mode.link ? '#session=' + 'S'.repeat(40) : '');
      await pg.goto(url, { waitUntil: 'load' });
      if (!mode.link) {
        await pg.fill('#u', 'jordan@example.com'); await pg.fill('#p', 'correct-horse'); await pg.fill('#d', '1979-05-14');
        await pg.click('#loginBtn');
      }
      await pg.waitForFunction(() => !!document.getElementById('recRetry'), null, { timeout: 15000 }).catch(() => {});
      const failed = await state(pg);
      assert.ok(failed.retry && /couldn't load your records/i.test(failed.retry), mode.name + ': the failure is not said: ' + JSON.stringify(failed)); checks++;
      assert.ok(!failed.empties.some((t) => /on file/.test(t)), mode.name + ': a failed load still says "on file": ' + JSON.stringify(failed.empties)); checks++;
      assert.ok(failed.counts.every((c) => c === '–'), mode.name + ': a failed load shows counts as if empty: ' + JSON.stringify(failed.counts)); checks++;
      await pg.click('#recRetry button');
      await pg.waitForFunction(() => !document.getElementById('recRetry'), null, { timeout: 10000 }).catch(() => {});
      const ok = await state(pg);
      assert.deepStrictEqual([ok.meds, ok.counts[0], ok.retry], [1, '1', false], mode.name + ': Try again did not load the records: ' + JSON.stringify(ok)); checks++;
      assert.strictEqual(ok.empties[2], 'No upcoming appointments on file.', mode.name + ': a truly empty list lost its wording after a retry'); checks++;
      await pg.context().close();
    }
    assert.deepStrictEqual(errs, [], 'page errors: ' + errs.join(' | ')); checks++;
    console.log('PASS patient portal says when records failed: ' + checks + ' checks - a 500 after sign-in and a cold-start 502 behind an invite link both say the records could not be loaded (never "on file"), and Try again loads them');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await b.close(); srv.close(); }
});
