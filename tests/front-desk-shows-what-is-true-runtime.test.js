'use strict';
/* The front desk shows what is true (stafffix-1.0.0, 2026-09-23).
   Found by the Staff hunt, in real Chrome with a receptionist session:
   - check-in board: a slow refresh for one day landed after the receptionist
     had moved to the next day and painted the old day's rows under the new
     date, so Cancel cancelled the wrong day's appointment; the patient
     waiting in the lobby (checked_in) sorted below the cancellations;
   - Settings: a failed load rendered an all-off form and Save then switched
     off the practice's reminders, confirmations and no-show messages; a
     receptionist's call-forwarding change said "Saved." but the server keeps
     it out;
   - Messages: a server error read as "No messages yet" and cleared the
     badge; a failed "Mark done" said nothing;
   - Copilot: "which patient?" offered blind "Choose match 1 / 2" buttons.
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

const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = fmt(new Date()); const TOM = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return fmt(t); })();

async function boot(b, port, api) {
  const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  pg.__errs = [];
  pg.on('pageerror', (e) => pg.__errs.push(String(e.message).slice(0, 200)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (/scrivara-backend\.onrender\.com/.test(u.host)) {
      let body = null; try { body = req.postDataJSON(); } catch (e) { body = null; }
      const out = await api(req.method(), u.pathname, u.search, body, r);
      if (out === 'handled') return;
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
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
  });
  await pg.waitForTimeout(2000);
  await pg.evaluate(HARNESS);
  await pg.evaluate(() => window.__clunky.seed());
  await pg.waitForTimeout(600);
  return pg;
}
const asReceptionist = (pg) => pg.evaluate(async () => {
  sessionStorage.setItem('sf_bk_token', 'harness-token');
  bkUser = { email: 'desk@mlsscribe.test', name: 'Desk Person', role: 'receptionist', hasAccess: true, capabilities: { scheduling: true, patientCharts: false, analytics: false } };
  applyAccessUI();
  await new Promise((r) => setTimeout(r, 800));
});

srv.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const port = srv.address().port;
  try {
    /* ---------- state the stubbed server holds ---------- */
    let slowToday = false, settingsGetFails = false, msgsFail = false, resolveFails = false;
    const updates = [], settingsPosts = [];
    let comms = { frontDeskPhone: '+15550001111', transferEnabled: true, calendarEnabled: true,
      reminders: { enabled: true, channels: ['sms'], dayBefore: true, hoursOf: true }, confirmations: { enabled: true, channels: ['sms'] },
      missedCall: { enabled: true, channels: ['sms'] }, waitlist: { enabled: false, channels: ['sms'] }, noShow: { enabled: true, channels: ['sms'] } };
    const rowsFor = (d) => d === TODAY
      ? [{ id: 601, name: 'Alice Today', status: 'booked', appt_date: d, start_at: d + 'T15:00:00Z' },
         { id: 603, name: 'Cara Cancelled', status: 'cancelled', appt_date: d, start_at: d + 'T14:00:00Z' },
         { id: 602, name: 'Bob Waiting', status: 'checked_in', appt_date: d, start_at: d + 'T16:00:00Z' }]
      : [{ id: 701, name: 'Carl Tomorrow', status: 'booked', appt_date: d, start_at: d + 'T15:00:00Z' }];
    const api = async (m, p, s, body, route) => {
      if (p === '/api/appointments' && m === 'GET') {
        const d = new URLSearchParams(s).get('date');
        const payload = JSON.stringify({ appointments: rowsFor(d), doctors: [] });
        if (slowToday && d === TODAY) { slowToday = false; setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: payload }).catch(() => {}), 2500); return 'handled'; }
        return { json: JSON.parse(payload) };
      }
      const mu = p.match(/^\/api\/appointments\/(\d+)\/update$/);
      if (mu) { updates.push({ id: Number(mu[1]), body }); slowToday = true; return { json: { ok: true } }; }
      if (p === '/api/messages') return msgsFail ? { status: 500, json: { error: 'Request failed.' } } : { json: { messages: [{ id: 9, from: '+15550002222', name: 'Pat Caller', body: 'Please call back about my refill.', status: 'new' }], unread: 1 } };
      if (/^\/api\/messages\/\d+\/resolve$/.test(p)) return resolveFails ? { status: 500, json: { error: 'Request failed.' } } : { json: { ok: true } };
      if (p === '/api/comms/settings' && m === 'GET') return settingsGetFails ? { status: 500, json: { error: 'Request failed.' } } : { json: { ok: true, comms, twilioReady: true } };
      if (p === '/api/comms/settings' && m === 'POST') {
        const bb = JSON.parse(JSON.stringify((body && body.comms) || {})); settingsPosts.push(JSON.parse(JSON.stringify(bb)));
        delete bb.frontDeskPhone; delete bb.transferEnabled; /* server rule for a front-desk account */
        comms = Object.assign({}, comms, bb); return { json: { ok: true, comms } };
      }
      return { status: 403, json: {} };
    };
    const pg = await boot(b, port, api);
    await asReceptionist(pg);
    await pg.evaluate(() => loadBoard(true)); await pg.waitForTimeout(1200);

    /* 1. the patient waiting in the lobby comes first, cancellations last */
    const order = await pg.evaluate(() => [...document.querySelectorAll('#boardBox > div > div:first-child > b')].map((x) => x.textContent));
    assert.ok(order.indexOf('Bob Waiting') >= 0 && order.indexOf('Bob Waiting') < order.indexOf('Alice Today') && order.indexOf('Alice Today') < order.indexOf('Cara Cancelled'),
      'checked-in sorts first, cancelled last: ' + JSON.stringify(order));

    /* 2. a slow refresh for today never paints under tomorrow's date */
    await pg.locator('#boardBox button:has-text("Check in")').first().click();
    await pg.waitForTimeout(300);
    await pg.locator('#boardBox button[onclick="changeBoardDate(1)"]').click();
    await pg.waitForTimeout(3200);
    const st = await pg.evaluate(() => ({ day: _boardDay(), rows: [...document.querySelectorAll('#boardBox > div > div:first-child > b')].map((x) => x.textContent) }));
    assert.strictEqual(st.day, TOM);
    assert.deepStrictEqual(st.rows, ['Carl Tomorrow'], 'tomorrow shows only tomorrow after today\'s late answer: ' + JSON.stringify(st));
    const before = updates.length;
    await pg.locator('#boardBox button:has-text("Cancel")').first().click(); await pg.waitForTimeout(800);
    const sent = updates.slice(before);
    assert.ok(sent.length === 0 || sent.every((u) => u.id === 701), 'Cancel acts on the appointment shown: ' + JSON.stringify(sent));

    /* 3. Settings: a failed load offers no Save that could switch everything off */
    settingsGetFails = true;
    await pg.locator('#rectab_settings').click(); await pg.waitForTimeout(800);
    const failed = await pg.evaluate(() => ({ text: document.getElementById('recSettings').innerText, save: !![...document.querySelectorAll('#recSettings button')].find((x) => /save settings/i.test(x.textContent)) }));
    assert.match(failed.text, /Could not load settings/, 'the failed load says so');
    assert.strictEqual(failed.save, false, 'no Save button after a failed load');
    assert.strictEqual(settingsPosts.length, 0);
    assert.strictEqual(comms.reminders.enabled, true, 'the practice\'s reminders are still on');

    /* 4. a receptionist sees call forwarding read-only and never sends it */
    settingsGetFails = false;
    await pg.locator('#rectab_frontdesk').click(); await pg.waitForTimeout(300);
    await pg.locator('#rectab_settings').click(); await pg.waitForTimeout(800);
    const ro = await pg.evaluate(() => ({ phone: document.getElementById('rcPhone').disabled, xfer: document.getElementById('rcTransfer').disabled, text: document.getElementById('recSettings').innerText }));
    assert.deepStrictEqual([ro.phone, ro.xfer], [true, true], 'call forwarding is read-only for the front desk');
    assert.match(ro.text, /Only the doctor or practice owner can change call forwarding/);
    await pg.locator('#recSettings button:has-text("Save settings")').click(); await pg.waitForTimeout(800);
    assert.strictEqual(settingsPosts.length, 1);
    assert.ok(!('frontDeskPhone' in settingsPosts[0]) && !('transferEnabled' in settingsPosts[0]), 'the save does not send call forwarding: ' + JSON.stringify(settingsPosts[0]));
    assert.strictEqual(settingsPosts[0].reminders.enabled, true, 'reminders stay as loaded');

    /* 5. Messages: a server error is not an empty inbox, and the badge stays */
    await pg.locator('#rectab_messages').click(); await pg.waitForTimeout(800);
    const badge1 = await pg.evaluate(() => (document.getElementById('recMsgBadge') || {}).textContent);
    msgsFail = true;
    await pg.evaluate(() => loadRecMessages()); await pg.waitForTimeout(600);
    const m = await pg.evaluate(() => ({ text: document.getElementById('recMessages').innerText, badge: (document.getElementById('recMsgBadge') || {}).textContent }));
    assert.match(m.text, /Could not load messages/, 'the error is said: ' + m.text.slice(0, 120));
    assert.ok(!/No messages yet/.test(m.text));
    assert.strictEqual(m.badge, badge1, 'the unread badge is not cleared by a failed load');

    /* 6. a failed "Mark done" says so */
    msgsFail = false; resolveFails = true;
    await pg.evaluate(() => loadRecMessages()); await pg.waitForTimeout(600);
    await pg.locator('#recMessages button:has-text("Mark done")').first().click(); await pg.waitForTimeout(700);
    const toastText = await pg.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
    assert.match(toastText, /Could not mark that message done/, 'a failed Mark done is reported: ' + toastText);

    /* 7. Copilot: same-name candidates are labelled from the chart */
    const labels = await pg.evaluate(() => {
      const pts = getPatients().filter((p) => p && p.id).slice(0, 2).map((p, i) => Object.assign(p, { name: 'Ada Twin', dob: i ? '1990-05-05' : '1960-01-01' }));
      _copilotHistory.length = 0;
      _copilotAskWhichPatient('openPatient', 'Ada Twin', pts);
      const stored = _copilotHistory[0].actions.map((a) => a.label);
      const btns = [...document.querySelectorAll('#copilotThread .cact-btn')].map((x) => x.textContent);
      return { stored, btns };
    });
    assert.ok(labels.stored.every((l) => /^Choose match \d+$/.test(l)), 'the saved thread keeps no identifiers: ' + JSON.stringify(labels.stored));
    assert.deepStrictEqual(labels.btns.map((t) => (t.match(/DOB (\S+)/) || [])[1]), ['1960-01-01', '1990-05-05'], 'each button names its chart: ' + JSON.stringify(labels.btns));

    assert.deepStrictEqual(pg.__errs, [], 'no page errors: ' + pg.__errs.join(' | '));
    console.log('PASS front desk shows what is true: a late refresh never paints another day\'s rows, waiting patients sort first, a failed settings load offers no Save, call forwarding is read-only for the front desk, failed message loads and Mark done say so, and Copilot names each same-name chart');
  } finally { await b.close(); srv.close(); }
});
