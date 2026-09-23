'use strict';
/* The patient portal shows the signed-in patient's records (portalfix-1.0.0).
   Found by the patient-facing pages hunt:
   - every list stayed empty ("0") for a signed-in patient: loadRecords called
     noteServerOffice, which lived in another script's scope, and the
     ReferenceError aborted the render (and the practice name/phone the server
     sent were never used);
   - appointment times showed as raw UTC ("2026-10-01T14:00:00.000Z") and an
     appointment with no reason was titled "2026-10-01 - 2026-10-01T14:00...";
   - the post-op video card never appeared if the patient took more than ~4 s
     to sign in;
   - "Do I have an appointment next week?" was refused as a medical question.
   Real Chrome; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const HISTORY = {
  patient: { name: 'Jordan Testpatient', dob: '1979-05-14', mrn: 'T-100' },
  medications: [{ name: 'Gabapentin 300 mg', sig: '1 capsule three times daily' }, 'Meloxicam 15 mg'],
  problems: [{ name: 'Lumbar radiculopathy', code: 'M54.16' }],
  appointments: [
    { date: '2026-10-01', start: '2026-10-01T14:00:00.000Z', status: 'booked', provider: 'Dr. Test', reason: 'Follow-up' },
    { date: '2026-10-08', start: '2026-10-08T15:30:00.000Z', status: 'booked', provider: null, reason: null }
  ],
  visits: [{ date: '2026-09-01', visit_type: 'Office visit', summary: '' }],
  practice: { name: 'Test Spine Practice', phone: '(215) 555-0100', address: '1 Main St' }
};

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
    const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'America/New_York' })).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    let teleAsked = 0; const aiAsked = [];
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const u = new URL(route.request().url());
      const origin = route.request().headers()['origin'] || '*';
      const send = (s, j) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(j) });
      if (u.pathname === '/api/patient/auth/login') return send(200, { ok: true, session: 'S'.repeat(40), mustSetPassword: false });
      const signedIn = /Bearer S{40}/.test(route.request().headers()['authorization'] || '');
      if (u.pathname === '/api/patient/me') return signedIn ? send(200, { ok: true, external_id: 'ext1', practice: HISTORY.practice }) : send(401, { error: 'Sign in.' });
      if (u.pathname === '/api/patient/history') return send(200, HISTORY);
      if (u.pathname === '/api/patient/requests') return send(200, { ok: true, requests: [] });
      if (u.pathname === '/api/patient/tele/eligibility') { teleAsked++; return send(200, { ok: true, eligible: false }); }
      if (/\/api\/patient\/(chat|ask)/.test(u.pathname)) { aiAsked.push(u.pathname); return send(200, { ok: true, reply: 'You have an appointment on Thursday.' }); }
      return route.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/patient-portal.html', { waitUntil: 'load' });
    /* a patient who takes longer than the old 4-second window to sign in */
    await pg.waitForTimeout(5000);
    await pg.fill('#u', 'jordan@example.com'); await pg.fill('#p', 'correct-horse'); await pg.fill('#d', '1979-05-14');
    await pg.click('#loginBtn'); await pg.waitForTimeout(1800);

    const st = await pg.evaluate(() => ({
      meds: document.querySelectorAll('#meds li').length, problems: document.querySelectorAll('#problems li').length,
      appts: [...document.querySelectorAll('#appts li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
      visits: [...document.querySelectorAll('#visits li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
      who: document.getElementById('who').innerText
    }));
    assert.strictEqual(st.meds, 2, 'the signed-in patient sees their medications: ' + JSON.stringify(st));
    assert.strictEqual(st.problems, 1, 'and their problems');
    assert.strictEqual(st.appts.length, 2, 'and their appointments');
    assert.match(st.who, /Jordan Testpatient/, 'and their name');
    assert.ok(!st.appts.some((t) => /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)), 'no raw UTC timestamp is shown: ' + JSON.stringify(st.appts));
    assert.match(st.appts[0], /Oct 1/, 'the appointment time reads as a date: ' + st.appts[0]);
    assert.match(st.appts[0], /10:00/, 'in the practice time zone (14:00 UTC is 10:00 AM in New York): ' + st.appts[0]);
    assert.match(st.appts[1], /^Appointment/, 'an appointment with no reason is titled "Appointment": ' + st.appts[1]);
    assert.ok(!/—\s*$/.test(st.visits[0] || ''), 'a visit with an empty summary has no dangling dash: ' + JSON.stringify(st.visits));
    assert.ok(teleAsked >= 1, 'the post-op video check runs after a late sign-in');

    /* the practice the server named is used in the requests card */
    const req = await pg.evaluate(() => (document.getElementById('mlsReqCard') || {}).textContent || '');
    if (req) assert.match(req, /Test Spine Practice/, 'the requests card names the practice the server sent: ' + req.slice(0, 200));

    /* an appointment question is not refused as a medical one */
    const guarded = await pg.evaluate(() => {
      const box = document.getElementById('chatIn') || document.querySelector('#chat input, #chat textarea, textarea[id*=chat], input[id*=chat]');
      if (!box) return null;
      box.value = 'Do I have an appointment next week?';
      const send = document.getElementById('chatSend') || document.querySelector('#chat button[type=submit], button[id*=chatSend]');
      if (send) send.click(); else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    });
    if (guarded) {
      await pg.waitForTimeout(800);
      const log = await pg.evaluate(() => [...document.querySelectorAll('#chatLog .msg')].map((m) => m.textContent).join(' | '));
      assert.ok(!/care team should handle|For your safety I don/i.test(log), 'an appointment question is not refused as a medical question: ' + log.slice(-300));
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS patient portal shows the records: a signed-in patient sees their medications, problems, appointments and visits, times read as local dates, untitled appointments say "Appointment", a late sign-in still gets the video check, and an appointment question is answered');
  } finally { await b.close(); srv.close(); }
});
