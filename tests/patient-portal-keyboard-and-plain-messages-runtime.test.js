'use strict';
/* The patient portal works from the keyboard and says plainly what happened
   (portalfix-1.0.0). Found by the patient-facing pages hunt on patient-portal.html:
   - in the sample-data preview "Start check-in" did nothing visible: its note
     went into the hidden check-in chat;
   - the sign-in field says Email, but the errors said "username";
   - a 400 from sign-in read "We couldn't reach the portal just now";
   - the suggested questions were 33px <span>s a keyboard could not reach,
     record rows could not be opened from the keyboard, and the request pop-up
     ignored Escape;
   - the "Need to be seen again?" card had no padding (text 1px from the border);
   - request text had no length limits, so the server cut it silently, and a
     400 from the server was shown as "Online requests aren't available".
   Real Chrome; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PRACTICE = { name: 'Test Spine Practice', phone: '(215) 555-0100', address: '1 Main St' };
const HISTORY = { patient: { name: 'Jordan Testpatient', dob: '1979-05-14' }, medications: [{ name: 'Gabapentin 300 mg', sig: '1 capsule three times daily', prescriber: 'Dr. Test', instructions: 'Take with food' }], problems: [], appointments: [], visits: [], practice: PRACTICE };
const DESK = { width: 1400, height: 900 }, PHONE = { width: 390, height: 844 };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (viewport, api, hash) => {
    const pg = await (await b.newContext({ viewport })).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'scrivara-backend.onrender.com') return route.fulfill({ status: 503, body: 'x' });
      const origin = route.request().headers()['origin'] || '*';
      const send = (s, j) => route.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(j) });
      const h = api(u.pathname);
      if (h) return send(h[0], h[1]);
      const signedIn = /Bearer S{40}/.test(route.request().headers()['authorization'] || '');
      if (u.pathname === '/api/patient/auth/login') return send(200, { ok: true, session: 'S'.repeat(40), mustSetPassword: false });
      if (u.pathname === '/api/patient/me') return signedIn ? send(200, { ok: true, practice: PRACTICE }) : send(401, { error: 'unauthorized' });
      if (u.pathname === '/api/patient/history') return send(200, HISTORY);
      if (u.pathname === '/api/patient/requests') return send(200, { ok: true, requests: [] });
      if (u.pathname === '/api/patient/tele/eligibility') return send(200, { ok: true, eligible: false });
      return route.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/patient-portal.html' + (hash || ''), { waitUntil: 'load' });
    await pg.waitForTimeout(300);
    return pg;
  };
  const signIn = async (pg) => {
    await pg.fill('#u', 'jordan@example.com'); await pg.fill('#p', 'correct-horse'); await pg.fill('#d', '1979-05-14');
    await pg.click('#loginBtn'); await pg.waitForTimeout(900);
  };
  const loginSays = async (status, body) => {
    const pg = await open(DESK, (p) => (p === '/api/patient/auth/login' ? [status, body] : null));
    await signIn(pg);
    return pg.$eval('#loginErr', (e) => e.innerText);
  };
  try {
    /* 1. sign-in errors use the word on the field, and a 400 is an answer, not an outage */
    const e401 = await loginSays(401, { error: 'invalid credentials' });
    assert.ok(/email/i.test(e401) && !/username/i.test(e401), 'a refused sign-in names the Email field, not a "username": ' + e401);
    const e400 = await loginSays(400, { error: 'bad request' });
    assert.ok(!/couldn.t reach|may be fine/i.test(e400), 'a 400 from sign-in is an answer, not an outage: ' + e400);
    assert.ok(/email/i.test(e400) && !/username/i.test(e400), 'a 400 from sign-in asks the patient to check their email and password: ' + e400);
    const e400s = await loginSays(400, { error: 'Please check the date of birth.', field: 'dob' });
    assert.match(e400s, /Please check the date of birth\./, 'a sentence the server sent with a 400 is shown: ' + e400s);

    /* 2. a setup link that cannot be completed points to the email sign-in */
    const pgc = await open(DESK, (p) => (p === '/api/patient/auth/claim' ? [404, {}] : null), '#claim=' + 'k'.repeat(32));
    await pgc.waitForTimeout(400);
    const claim = await pgc.$eval('#mcBody', (e) => e.innerText);
    assert.ok(/email/i.test(claim) && !/username/i.test(claim), 'the setup-link message names the email sign-in: ' + claim);

    /* 3. the sample-data preview, on a desktop and a phone */
    for (const [name, vp] of [['desktop', DESK], ['phone', PHONE]]) {
      const pg = await open(vp, () => null);
      await pg.click('#demoBtn'); await pg.waitForTimeout(500);

      const card = await pg.evaluate(() => {
        const c = document.getElementById('bookingBtn').closest('.card'), t = c.querySelector('b');
        const cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
        return { left: Math.round(tr.left - cr.left), top: Math.round(tr.top - cr.top) };
      });
      assert.ok(card.left >= 12 && card.top >= 10, name + ': the "Need to be seen again?" text sits inside the card, not on its border: ' + JSON.stringify(card));

      const chips = await pg.$$eval('#chips .chip', (els) => els.map((e) => ({ tag: e.tagName, h: Math.round(e.getBoundingClientRect().height), tab: e.tabIndex })));
      assert.ok(chips.length >= 4 && chips.every((c) => c.tag === 'BUTTON' && c.h >= 40 && c.tab >= 0), name + ': suggested questions are buttons at least 40px tall that a keyboard can reach: ' + JSON.stringify(chips));
      await pg.locator('#chips .chip').first().focus(); await pg.keyboard.press('Enter'); await pg.waitForTimeout(700);
      const asked = await pg.$$eval('#chatLog .msg.me', (ms) => ms.map((m) => m.textContent));
      assert.ok(asked.includes('What medications am I taking?'), name + ': Enter on a suggested question asks it: ' + JSON.stringify(asked));

      await pg.click('#mlsAvStart'); await pg.waitForTimeout(300);
      const note = await pg.evaluate(() => {
        const c = document.getElementById('mlsAvCard');
        if (!/Sample preview only/.test(c.innerText)) return null;
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (/Sample preview only/.test(n.nodeValue)) {
          const el = n.parentElement, r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight, live: !!el.closest('[aria-live],[role=status]') };
        }
        return null;
      });
      assert.ok(note && note.h > 0 && note.top >= 0 && note.bottom <= note.vh, name + ': "Start check-in" in the preview shows its note where the patient is looking: ' + JSON.stringify(note));
      assert.ok(note.live, name + ': and the note is announced');
    }

    /* 4. signed in: record rows by keyboard; the request pop-up's limits, Escape, and the server's 400 */
    const pgr = await open(DESK, (p) => (p === '/api/patient/request' ? [400, { ok: false, error: 'too_long', message: 'Please keep your message under 2000 characters.' }] : null));
    await signIn(pgr);
    /* a record row with more detail opens from the keyboard */
    const head = pgr.locator('#meds li.li-x .li-head').first();
    const row = () => head.evaluate((e) => ({ tab: e.tabIndex, exp: e.getAttribute('aria-expanded'), open: e.closest('li').getAttribute('data-exp'), h: Math.round(e.closest('li').querySelector('.li-detail').getBoundingClientRect().height) }));
    let st = await row();
    assert.ok(st.tab >= 0 && st.exp === 'false', 'a record row can be reached from the keyboard and says it is collapsed: ' + JSON.stringify(st));
    await head.focus(); await pgr.keyboard.press('Enter'); await pgr.waitForTimeout(100);
    st = await row();
    assert.ok(st.open === '1' && st.exp === 'true' && st.h > 0, 'Enter opens the record row: ' + JSON.stringify(st));
    await pgr.keyboard.press('Space'); await pgr.waitForTimeout(100);
    st = await row();
    assert.ok(st.open === '0' && st.exp === 'false', 'Space closes it again: ' + JSON.stringify(st));

    const LIMITS = { refill: { mReqOther: 400, mReqPharm: 300, mReqNote: 1000 }, appointment: { mReqReason: 1000 }, injection: { mReqProc: 200, mReqQ: 1000 }, pain: { mReqPain: 1000 }, message: { mReqMsg: 2000 } };
    for (const [type, fields] of Object.entries(LIMITS)) {
      await pgr.click('.reqbtn[data-req="' + type + '"]'); await pgr.waitForTimeout(200);
      const got = await pgr.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, (document.getElementById(id) || {}).maxLength])), Object.keys(fields));
      assert.deepStrictEqual(got, fields, 'the ' + type + ' request fields stop at the length the server keeps: ' + JSON.stringify(got));
      await pgr.keyboard.press('Escape'); await pgr.waitForTimeout(150);
      assert.ok(!(await pgr.$('.mlsm-back')), 'Escape closes the ' + type + ' request pop-up');
    }
    await pgr.click('.reqbtn[data-req="message"]'); await pgr.waitForTimeout(200);
    await pgr.fill('#mReqMsg', 'Please call me about my visit.');
    await pgr.click('#mReqSend'); await pgr.waitForTimeout(600);
    const res = await pgr.evaluate(() => ({ said: document.getElementById('mReqRes').innerText, typed: document.getElementById('mReqMsg').value, sendOff: document.getElementById('mReqSend').disabled }));
    assert.match(res.said, /under 2000 characters/, 'a 400 from the server shows the server\'s own message: ' + res.said);
    assert.ok(!/aren.t available/i.test(res.said), 'a 400 is not reported as "requests aren\'t available": ' + res.said);
    assert.ok(res.typed === 'Please call me about my visit.' && !res.sendOff, 'the typed message stays and can be sent again: ' + JSON.stringify(res));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS patient portal keyboard and plain messages: sign-in errors say email and a 400 is not an outage, suggested questions and record rows work from the keyboard, the preview check-in note is visible, the booking card has room, and request fields stop at the server limits, close on Escape and show the server\'s 400');
  } finally { await b.close(); srv.close(); }
});
