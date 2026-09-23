'use strict';
/* Portal requests: a saved "Mark reviewed" is reported as saved (stafffix-1.0.0,
   2026-09-23). Found by the Staff hunt in real Chrome with a doctor session:
   - "Mark reviewed" chained the list reload into the same catch, so when the
     POST succeeded (200) but the following GET failed, the list was emptied
     and the notice said "Portal requests could not load. Try again; no
     request was changed." - the request HAD just been marked on the server;
   - the "new requests" badge only moved on a load of the New filter, so a
     mark made from All (or a mark whose reload failed) left it one too high.
   A 200 from /handled changes exactly one new request (the server answers
   404 otherwise), so the badge drops by one whichever filter is open.
   Real Chrome; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(ROOT, 'tests/1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const DESK = { viewport: { width: 1400, height: 900 } };

/* the stubbed server: the same rules as src/routes/patientRequest.js */
function portalServer() {
  const s = { failList: false, failListAfterPost: false, failHandled: false, posts: [], reqs: [
    { id: 11, ref: 'PR-11', category: 'Refill', patient_external_id: 'syn-0', status: 'new', created_at: '2026-09-22T10:00:00Z', data: { medication: 'Gabapentin 300mg', pharmacy: 'CVS' }, notification: { delivered: true } },
    { id: 12, ref: 'PR-12', category: 'Appointment', patient_external_id: 'syn-1', status: 'new', created_at: '2026-09-21T10:00:00Z', data: { reason: 'Follow up' } },
    { id: 13, ref: 'PR-13', category: 'Question', patient_external_id: 'no-such-chart', status: 'new', created_at: '2026-09-20T10:00:00Z', data: { question: 'Can I drive?' } },
    { id: 9, ref: 'PR-9', category: 'Question', patient_external_id: 'syn-2', status: 'handled', created_at: '2026-09-10T10:00:00Z', data: { question: 'Earlier question' } },
  ] };
  s.newCount = () => s.reqs.filter((x) => x.status === 'new').length;
  s.api = async (m, p, q) => {
    if (p === '/api/patient/admin/requests' && m === 'GET') {
      if (s.failList) return { status: 500, json: { error: 'boom' } };
      const st = new URLSearchParams(q).get('status');
      return { json: { ok: true, requests: s.reqs.filter((x) => !st || x.status === st) } };
    }
    const mh = p.match(/^\/api\/patient\/admin\/requests\/(\d+)\/handled$/);
    if (mh && m === 'POST') {
      s.posts.push(Number(mh[1]));
      if (s.failHandled) return { status: 500, json: { ok: false } };
      const row = s.reqs.find((x) => x.id === Number(mh[1]) && x.status === 'new');
      if (!row) return { status: 404, json: { ok: false, error: 'not_found' } };
      row.status = 'handled';
      if (s.failListAfterPost) s.failList = true;
      return { json: { ok: true, status: 'reviewed' } };
    }
    if (p === '/api/appointments') return { json: { appointments: [], doctors: [] } };
    return null;
  };
  return s;
}

async function boot(b, port, ctxOpts, api) {
  const pg = await (await b.newContext(ctxOpts)).newPage();
  pg.__errs = [];
  pg.on('pageerror', (e) => pg.__errs.push(String(e.message).slice(0, 200)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (/scrivara-backend\.onrender\.com/.test(u.host)) {
      const out = await api(req.method(), u.pathname, u.search);
      if (out) return r.fulfill({ status: out.status || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out.json || {}) });
    }
    return r.fulfill({ status: 503, body: 'x' });
  });
  await pg.goto('http://127.0.0.1:' + port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await pg.waitForTimeout(3000);
  await pg.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
    window.aiCallRaw = function () { return Promise.reject(new Error('AI is not used by this test')); };
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
  });
  await pg.waitForTimeout(2000);
  await pg.evaluate(HARNESS);
  await pg.evaluate(() => window.__clunky.seed());
  await pg.waitForTimeout(600);
  await pg.evaluate(async () => {
    sessionStorage.setItem('sf_bk_token', 'harness-token');
    bkUser = { email: 'doc@mlsscribe.test', name: 'Doc Person', role: 'doctor', hasAccess: true, capabilities: {} };
    applyAccessUI();
    await new Promise((r) => setTimeout(r, 800));
  });
  /* the idle loader in 1p-mls-connect.js brings the inbox in after sign-in */
  await pg.waitForFunction(() => !!window.__mlsPortalRequestInbox && !!document.getElementById('mlsPortalRequestInboxBtn'), null, { timeout: 60000 });
  return pg;
}

const state = (pg) => pg.evaluate(() => {
  const list = document.getElementById('mlsPrqList');
  const notice = document.getElementById('mlsPrqNotice');
  return {
    cards: [...document.querySelectorAll('.mlsPrqCard')].map((c) => (c.querySelector('.mlsPrqMeta') || {}).textContent.split(' | ')[0]),
    reviewedCards: [...document.querySelectorAll('.mlsPrqCard .mlsPrqMeta')].filter((x) => / \| Reviewed$/.test(x.textContent)).length,
    loading: !!(list && /Loading portal requests/.test(list.textContent)),
    notice: notice && notice.style.display !== 'none' ? notice.textContent : '',
    badge: (document.querySelector('#mlsPortalRequestInboxBtn .mlsPrqCount') || {}).textContent,
    on: [...document.querySelectorAll('.mlsPrqFilter.on')].map((x) => x.getAttribute('data-status')).join(','),
  };
});
const settled = (pg) => pg.waitForFunction(() => {
  const list = document.getElementById('mlsPrqList');
  return !!list && !/Loading portal requests/.test(list.textContent) && !document.querySelector('.mlsPrqAction[disabled].primary');
}, null, { timeout: 20000 });

async function scenario(b, port, ctxOpts, label) {
  const s = portalServer();
  const pg = await boot(b, port, ctxOpts, s.api);
  await pg.evaluate(() => window.__mlsPortalRequestInbox.open());
  await settled(pg);
  let st = await state(pg);
  assert.deepStrictEqual(st.cards, ['PR-11', 'PR-12', 'PR-13'], label + ': New lists the three new requests: ' + JSON.stringify(st));
  assert.strictEqual(st.badge, '3', label + ': the badge counts three new requests');

  /* 1. a mark made from All moves the badge */
  await pg.locator('.mlsPrqFilter[data-status=all]').click();
  await pg.waitForFunction(() => document.querySelectorAll('.mlsPrqCard').length === 4, null, { timeout: 20000 });
  await pg.locator('.mlsPrqAction.primary').first().click();
  await pg.waitForFunction(() => document.querySelectorAll('.mlsPrqCard .mlsPrqMeta').length && [...document.querySelectorAll('.mlsPrqCard .mlsPrqMeta')].filter((x) => / \| Reviewed$/.test(x.textContent)).length === 2, null, { timeout: 20000 });
  st = await state(pg);
  assert.deepStrictEqual(s.posts, [11], label + ': the first new request was marked');
  assert.strictEqual(s.newCount(), 2, label + ': the server now holds two new requests');
  assert.strictEqual(st.badge, '2', label + ': after a mark made from All the badge says 2, as the server does: ' + JSON.stringify(st));
  assert.strictEqual(st.notice, '', label + ': a clean mark shows no notice');

  /* 2. POST 200, then the list reload answers 500 */
  await pg.locator('.mlsPrqFilter[data-status=new]').click();
  await pg.waitForFunction(() => document.querySelectorAll('.mlsPrqCard').length === 2, null, { timeout: 20000 });
  s.failListAfterPost = true;
  await pg.locator('.mlsPrqAction.primary').first().click();
  await pg.waitForFunction(() => { const n = document.getElementById('mlsPrqNotice'); return !!n && n.style.display !== 'none' && !!n.textContent; }, null, { timeout: 20000 });
  await settled(pg);
  st = await state(pg);
  assert.deepStrictEqual(s.posts, [11, 12], label + ': request 12 was marked');
  assert.strictEqual(s.newCount(), 1, label + ': the server now holds one new request');
  assert.ok(!/no request was changed/i.test(st.notice), label + ': a saved mark is never reported as "no request was changed": ' + JSON.stringify(st));
  assert.strictEqual(st.notice, 'Marked reviewed. The list could not refresh.', label + ': the notice says the mark was saved and the list is not fresh: ' + JSON.stringify(st));
  assert.deepStrictEqual(st.cards, ['PR-13'], label + ': the other new request stays on screen and the reviewed one leaves New: ' + JSON.stringify(st));
  assert.strictEqual(st.badge, '1', label + ': the badge follows the saved mark even though the reload failed: ' + JSON.stringify(st));
  assert.ok(await pg.locator('#mlsPrqNotice').isVisible(), label + ': the notice is on screen');

  /* 3. a failed POST still says nothing changed, and the badge stays */
  s.failListAfterPost = false; s.failList = false; s.failHandled = true;
  await pg.locator('.mlsPrqAction.primary').first().click();
  await pg.waitForFunction(() => { const n = document.getElementById('mlsPrqNotice'); return !!n && /Could not update/.test(n.textContent); }, null, { timeout: 20000 });
  st = await state(pg);
  assert.strictEqual(st.notice, 'Could not update this request. Nothing else was changed.', label + ': a refused mark says so');
  assert.strictEqual(st.badge, '1', label + ': a refused mark does not move the badge');
  assert.deepStrictEqual(st.cards, ['PR-13'], label + ': a refused mark keeps the card');
  const btn = await pg.evaluate(() => { const x = document.querySelector('.mlsPrqAction.primary'); return x && { text: x.textContent, disabled: x.disabled }; });
  assert.deepStrictEqual(btn, { text: 'Mark reviewed', disabled: false }, label + ': the refused card can be tried again');

  /* 4. a plain failed load (no mark) keeps its old wording */
  s.failHandled = false; s.failList = true;
  await pg.locator('.mlsPrqFilter[data-status=handled]').click();
  await pg.waitForFunction(() => { const n = document.getElementById('mlsPrqNotice'); return !!n && /could not load/.test(n.textContent); }, null, { timeout: 20000 });
  st = await state(pg);
  assert.strictEqual(st.notice, 'Portal requests could not load. Try again; no request was changed.', label + ': a failed load with no mark keeps its wording');

  /* 5. with the server back, New matches the badge */
  s.failList = false;
  await pg.locator('.mlsPrqFilter[data-status=new]').click();
  await pg.waitForFunction(() => document.querySelectorAll('.mlsPrqCard').length === 1, null, { timeout: 20000 });
  st = await state(pg);
  assert.strictEqual(st.badge, '1', label + ': the badge matches the refreshed New list');
  assert.deepStrictEqual(pg.__errs, [], label + ': no page errors: ' + pg.__errs.join(' | '));
  await pg.context().close();
}

srv.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const port = srv.address().port;
  try {
    await scenario(b, port, DESK, 'desktop');
    await scenario(b, port, PHONE, 'phone');
    console.log('PASS portal requests: a saved "Mark reviewed" whose list reload fails says it was saved and keeps the other cards, a refused mark still says nothing changed, and the New badge follows every saved mark on any filter (desktop and phone)');
  } catch (e) {
    console.error(e && e.stack || e); process.exitCode = 1;
  } finally { await b.close(); srv.close(); }
});
