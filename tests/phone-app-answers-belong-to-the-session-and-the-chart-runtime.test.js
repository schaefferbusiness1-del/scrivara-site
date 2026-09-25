'use strict';
/* h9-1.0.0 (2026-09-25): the phone app (app.html) shows a doctor only that
   doctor's day, and a patient only that patient's visits. Both were red at
   site f57f2aaf, in real Chrome:

   LP-3  A schedule or check-in answer still loading when doctor A signed out
         landed after doctor B signed in on the same phone and was painted as
         B's Today screen: A's patient and A's red-flag brief, under B's token.
         api() now keeps the token each request went out with and drops an
         answer that comes back to a different session.
   LP-4  A self-booked appointment has no chart id. The patient screen then
         fetched the practice's recent records and kept every one whose patient
         NAME matched, so a 1990 John Smith was shown a 1951 John Smith's
         procedure. Visits are now read by chart id only, and a chart id is
         adopted only when the name AND the date of birth both match.

   h9-1.1.0 (2026-09-25), red at round 1 of that fix:
   - When a name + DOB match links an appointment to its chart, the screen
     said "No visits in this chart yet" for as long as that chart's visits took
     to load (the whole of a cold start). It now shows the loading state.
   - A patient opened from Find with no chart id was told "This appointment is
     not linked to a chart"; no appointment is involved there.

   The backend is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://scrivara-backend.onrender.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' };
let checks = 0;

const srv = http.createServer((q, r) => {
  const p = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];

  /* One phone. `backend(who, path, url, req)` answers each API call; `who` is
     the doctor whose token the call carries. */
  async function phone(backend) {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    const seen = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      if (u.origin !== API) return route.abort('blockedbyclient');
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const auth = req.headers().authorization || '';
      const who = (/Bearer tok-(\w+)/.exec(auth) || [])[1] || '';
      seen.push(req.method() + ' ' + u.pathname + u.search);
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      if (u.pathname === '/api/auth/login') {
        const email = JSON.parse(req.postData() || '{}').email || '';
        return json(200, { token: 'tok-' + email.split('-')[0], user: { email, role: 'user' } });
      }
      if (u.pathname === '/api/agreements/me') return json(200, { userAccess: { status: 'granted' } });
      if (u.pathname === '/api/relay/presence') return json(200, { ok: false });
      const answer = await backend(who, u.pathname, u, req);
      if (answer) return json(answer[0], answer[1]);
      return json(404, { error: 'not stubbed' });
    });
    await page.goto(base + '/app.html', { waitUntil: 'load' });
    return { page, seen, close: () => ctx.close() };
  }
  async function signIn(page, email) {
    await page.fill('#emailInput', email);
    await page.fill('#pwInput', 'synthetic-password');
    await page.click('#goBtn');
    await page.waitForSelector('#today:not(.hide)');
  }
  const text = (page, id) => page.locator('#' + id).innerText().then((t) => t.replace(/\s+/g, ' '));

  try {
    /* ---- LP-3: doctor A's late answers never reach doctor B ------------- */
    for (const bDay of ['loads', 'fails']) {
      const { page, close } = await phone(async (who, p) => {
        if (p === '/api/appointments') {
          if (who === 'a') { await sleep(1800); return [200, { appointments: [{ id: 1, name: 'ALICE ADAMS', dob: '1960-01-01', start_local: '09:00', reason: 'lumbar ESI follow-up', patient_external_id: 'A1' }] }]; }
          await sleep(150);
          return bDay === 'loads'
            ? [200, { appointments: [{ id: 2, name: 'BOB BROWN', dob: '1970-05-05', start_local: '10:00', reason: 'neck pain', patient_external_id: 'B1' }] }]
            : [503, { error: 'Service warming up' }];
        }
        if (p === '/api/avatar/checkins') {
          if (who === 'a') { await sleep(1800); return [200, { checkins: [{ id: 7, headline: '⚠ reports new bowel incontinence', patient_external_id: 'A1', ready_at: new Date().toISOString(), turns: 9 }] }]; }
          return [200, { checkins: [] }];
        }
        return null;
      });
      try {
        await signIn(page, 'a-doctor@example.test');
        await page.click('#outBtn');                 // A leaves while the day is still loading
        await page.waitForSelector('#signin:not(.hide)');
        await signIn(page, 'b-doctor@example.test');
        await sleep(2600);                           // A's answers have all come back by now
        const today = await text(page, 'todayBody');
        assert.ok(!today.includes('ALICE ADAMS'), `B's Today screen (B's day ${bDay}) shows doctor A's patient: ${today}`);
        assert.ok(!today.includes('bowel incontinence'), `B's Today screen (B's day ${bDay}) shows doctor A's check-in brief: ${today}`);
        if (bDay === 'loads') assert.ok(today.includes('BOB BROWN'), `B's own schedule is missing: ${today}`);
        else assert.ok(/warming up/i.test(await text(page, 'today')), 'B\'s own load error was wiped by an answer that was not B\'s');
        assert.strictEqual(await page.evaluate(() => Object.values(localStorage).some((v) => v === 'tok-b')), true, 'B is no longer signed in');
        checks += 3;
      } finally { await close(); }
    }

    /* ---- LP-4: visits by chart id, never by name --------------------------- */
    const RECORDS = {
      'ATH-4471': [{ id: 90, note_date: '2026-08-14', visit_type: 'Lumbar ESI L4-5 (post-procedure)', em: '99214', signed: true, patient_external_id: 'ATH-4471', record: { patientName: 'John Smith', patientDob: '1951-07-19' } }],
      'ATH-5': [{ id: 95, note_date: '2026-07-01', visit_type: 'Radiofrequency ablation', em: '99213', signed: true, patient_external_id: 'ATH-5', record: { patientName: 'Jane Doe', patientDob: '1948-03-03' } }],
      'ATH-77': [{ id: 97, note_date: '2026-05-05', visit_type: 'Cervical MBB', em: '99213', signed: true, patient_external_id: 'ATH-77', record: { patientName: 'Ray Park', patientDob: '1980-08-08' } }]
    };
    const { page, seen, close } = await phone(async (who, p, u) => {
      if (p === '/api/avatar/checkins') return [200, { checkins: [] }];
      if (p === '/api/appointments') return [200, { appointments: [
        { id: 11, name: 'John Smith', dob: '1990-02-03', start_local: '10:00', reason: 'New patient', patient_external_id: null },
        { id: 12, name: 'Jane Doe', dob: '', start_local: '10:30', reason: 'Phone booking', patient_external_id: null },
        { id: 13, name: 'Ray Park', dob: '1980-08-08', start_local: '11:00', reason: 'Follow-up', patient_external_id: null }
      ] }];
      if (p === '/api/patients/search') {
        const q = (u.searchParams.get('q') || '').toLowerCase();
        const all = [
          { external_id: 'ATH-4471', label: 'John Smith', data: { name: 'John Smith', dob: '1951-07-19', mrn: 'M-4471' } },
          { external_id: 'ATH-5', label: 'Jane Doe', data: { name: 'Jane Doe', dob: '1948-03-03', mrn: 'M-5' } },
          { external_id: 'ATH-77', label: 'Ray Park', data: { name: 'Ray Park', dob: '1980-08-08', mrn: 'M-77' } },
          { external_id: null, label: 'Kim Lee', data: { name: 'Kim Lee', dob: '1975-04-04', mrn: 'M-9' } }
        ];
        return [200, { patients: all.filter((r) => r.label.toLowerCase() === q) }];
      }
      if (p === '/api/records') {
        const id = u.searchParams.get('patient_external_id');
        return [200, { records: id ? (RECORDS[id] || []) : [].concat(...Object.values(RECORDS)) }];
      }
      return null;
    });
    try {
      await signIn(page, 'c-doctor@example.test');
      await page.waitForSelector('#todayBody .row');
      const open = async (name) => {
        await page.locator('#todayBody .row', { hasText: name }).first().click();
        await page.waitForSelector('#patient:not(.hide)');
        await page.waitForFunction(() => !/Loading the chart/.test(document.getElementById('patientBody').innerText));
        await sleep(700);                            // the name search and any follow-up read settle
        const body = await text(page, 'patientBody');
        await page.click('#backBtn');
        await page.waitForSelector('#today:not(.hide)');
        return body;
      };

      /* same name, different date of birth, no chart id */
      const john = await open('John Smith');
      assert.ok(!john.includes('Lumbar ESI'), 'a self-booked John Smith (1990) is shown another John Smith\'s (1951) visit: ' + john);
      assert.ok(john.includes('No linked chart'), 'an unlinked patient does not say why no visits are shown: ' + john);
      assert.ok(john.includes('This appointment is not linked to a chart'), 'an unlinked appointment does not say it is the appointment: ' + john);
      checks += 2;

      /* same name, no date of birth on the appointment: a name alone links nothing */
      const jane = await open('Jane Doe');
      assert.ok(!jane.includes('Radiofrequency ablation'), 'a name with no date of birth was linked to a chart: ' + jane);
      checks++;

      /* name AND date of birth match: the chart is linked and its visits are read by its id */
      const ray = await open('Ray Park');
      assert.ok(ray.includes('Cervical MBB'), 'a patient whose name and date of birth match the chart lost its visits: ' + ray);
      checks++;

      /* h9-1.1.0: opened from Find, a patient row with no chart id is not
         an appointment, and the empty state does not call it one. */
      await page.fill('#findInput', 'Kim Lee');
      await page.locator('#todayBody .row', { hasText: 'Kim Lee' }).first().click();
      await page.waitForSelector('#patient:not(.hide)');
      await page.waitForFunction(() => !/Loading the chart/.test(document.getElementById('patientBody').innerText));
      const kim = await text(page, 'patientBody');
      assert.ok(kim.includes('No linked chart') && kim.includes('This patient record is not linked to a chart'),
        'a Find patient with no chart id does not say why no visits are shown: ' + kim);
      assert.ok(!/appointment/i.test(kim), 'a patient opened from Find is described as an appointment: ' + kim);
      checks++;

      const unscoped = seen.filter((s) => /^GET \/api\/records/.test(s) && !/patient_external_id=/.test(s));
      assert.deepStrictEqual(unscoped, [], 'the phone read records with no chart id: ' + JSON.stringify(unscoped));
      checks++;
    } finally { await close(); }

    /* ---- h9-1.1.0: a chart linked by name + DOB loads slowly (cold start) -- */
    {
      const { page, close } = await phone(async (who, p, u) => {
        if (p === '/api/avatar/checkins') return [200, { checkins: [] }];
        if (p === '/api/appointments') return [200, { appointments: [
          { id: 13, name: 'Ray Park', dob: '1980-08-08', start_local: '11:00', reason: 'Follow-up', patient_external_id: null }] }];
        if (p === '/api/patients/search') {
          await sleep(150);
          return [200, { patients: [{ external_id: 'ATH-77', label: 'Ray Park', data: { name: 'Ray Park', dob: '1980-08-08', mrn: 'M-77' } }] }];
        }
        if (p === '/api/records' && u.searchParams.get('patient_external_id') === 'ATH-77') {
          await sleep(2500);
          return [200, { records: RECORDS['ATH-77'] }];
        }
        return null;
      });
      try {
        await signIn(page, 'd-doctor@example.test');
        await page.waitForSelector('#todayBody .row');
        await page.click('#todayBody .row');
        const t0 = Date.now();
        const samples = [];
        for (;;) {
          const at = Date.now() - t0;
          const body = await text(page, 'patientBody');
          samples.push([at, body]);
          if (body.includes('Cervical MBB') || at > 7000) break;
          await sleep(100);
        }
        const trace = samples.map(([at, b]) => `t+${at}ms ${b.slice(0, 60)}`).join('\n');
        assert.ok(!samples.some(([, b]) => /No visits in this chart yet/.test(b)),
          'while the linked chart was still loading, the screen said it has no visits:\n' + trace);
        const loading = samples.filter(([at]) => at >= 600 && at <= 2000);
        assert.ok(loading.length && loading.every(([, b]) => b.includes('Loading the chart')),
          'the linked chart\'s visits were loading but the screen did not say so:\n' + trace);
        assert.ok(samples[samples.length - 1][1].includes('Cervical MBB'), 'the linked chart\'s visit never arrived:\n' + trace);
        checks += 2;
      } finally { await close(); }
    }

    assert.deepStrictEqual(errors, [], 'page errors: ' + errors.join(' | '));
    console.log(`PASS phone app answers belong to the session and the chart: ${checks} checks — a signed-out doctor's late answers never reach the next doctor, visits are read by chart id only, a chart linked while open shows as loading until its visits arrive, and the empty state names where the patient came from`);
  } catch (e) {
    console.error(e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.close();
  }
});
