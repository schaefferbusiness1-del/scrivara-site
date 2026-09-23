'use strict';
/* The pre-visit intake says what went wrong, stops waiting, checks the date of
   birth, and takes "no pain" as an answer (portalfix-1.0.0, 2026-09-23).
   Found by the patient-page hunt on intake.html:
   - a dead link (404 "This pre-visit link is no longer active."), a 413 and a
     500 on submit all read "Check your entries and try again" - none of them
     is fixed by the entries;
   - a backend that never answers left intake, booking and appointment on
     "Loading..." with no button after 20 s: the shared fetch wrapper had no
     timeout, while intake.html's own comment spoke of a 15 s abort;
   - a date of birth of 2031-05-05 or 20255-01-01 was sent as-is, and the
     server's 400 {field:'dob'} was not shown by the field;
   - the custom-questions header was a 24px H2 among 16px H3 section headers;
   - a patient with no pain could not answer 0 (Home / Left / a tap at 0 left
     "—" and pain was sent as null).
   Real Chromium; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TOKEN = 'a'.repeat(48);
const API = 'https://scrivara-backend.onrender.com/**';
const INTAKE_OK = { ok: true, practice: { name: 'Synthetic Spine Clinic', phone: '(215) 555-0100', address: '' }, questions: ['Do you use a cane?'] };
const BOOK_OK = { ok: true, practice: { name: 'Synthetic Spine Clinic' }, doctors: [], availability: { tz: 'America/New_York', slotMin: 30, days: [1, 2, 3, 4, 5] } };
const APPT_OK = { ok: true, appointment: { name: 'Pat Example', when: 'Monday, October 5 at 9:00 AM', practice: 'Synthetic Spine Clinic', status: 'booked', confirmed: false } };
const VIEWPORTS = { desktop: { viewport: { width: 1400, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const BASE = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [], problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const send = (route, status, body) => route.fulfill({ status, contentType: typeof body === 'string' ? 'text/plain' : 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
  const newPage = async (vp, api) => {
    const ctx = await b.newContext(VIEWPORTS[vp]);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(vp + ': ' + String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.route(API, api);
    return pg;
  };
  /* intake with a live link; submit(route, data) answers the POST */
  const openIntake = async (vp, submit) => {
    const sent = [];
    const pg = await newPage(vp, (route) => {
      if (/\/submit$/.test(route.request().url())) { const d = JSON.parse(route.request().postData()).data; sent.push(d); return submit(route, d); }
      return send(route, 200, INTAKE_OK);
    });
    await pg.goto(BASE + '/intake.html?token=' + TOKEN);
    await pg.waitForSelector('#formWrap:not(.hide)', { timeout: 10000 });
    return { pg, sent };
  };
  const fillRequired = async (pg, dob) => {
    await pg.fill('#name', 'Pat Example'); await pg.fill('#dob', dob);
    await pg.fill('#chief', 'low back pain'); await pg.fill('#meds', 'ibuprofen');
  };
  const submitAndSettle = async (pg) => {
    await pg.click('#submitBtn');
    await pg.waitForFunction(() => !document.getElementById('submitBtn').disabled || !document.getElementById('done').classList.contains('hide'), null, { timeout: 45000 });
    await pg.waitForTimeout(150);
  };
  const shown = (pg, id) => pg.evaluate((i) => { const e = document.getElementById(i); return !!e && !e.classList.contains('hide') && e.getBoundingClientRect().height > 0; }, id);
  try {
    /* 1. a backend that never answers: intake, booking and appointment leave
          "Loading..." after the 45 s read limit (the page clock is fast-forwarded),
          and Try again works once it answers */
    const stalls = [
      { name: 'intake.html', url: '/intake.html?token=' + TOKEN, trouble: 'offline', ok: INTAKE_OK, loaded: 'formWrap' },
      { name: 'booking.html', url: '/booking.html?token=' + 'b'.repeat(40), trouble: 'trouble', ok: BOOK_OK, loaded: 'formCard' },
      { name: 'appointment.html', url: '/appointment.html?t=' + 'p'.repeat(48), trouble: 'offline', ok: APPT_OK, loaded: 'view' },
    ];
    await Promise.all(stalls.map(async (s) => {
      s.stall = true;
      s.pg = await newPage('desktop', (route) => (s.stall ? new Promise(() => {}) : send(route, 200, s.ok)));
      await s.pg.clock.install();
      await s.pg.goto(BASE + s.url);
      await s.pg.waitForTimeout(600);
      /* still loading well inside the limit: a cold start (30-60 s) is waited out */
      await s.pg.clock.fastForward(30000);
      s.at30 = await shown(s.pg, 'loading');
      await s.pg.clock.fastForward(16500);
      await s.pg.waitForTimeout(300);
    }));
    for (const s of stalls) {
      const loading = await shown(s.pg, 'loading'), trouble = await shown(s.pg, s.trouble);
      const retry = await s.pg.evaluate((id) => { const box = document.getElementById(id); const btn = box && [...box.querySelectorAll('button')].find((x) => /try again/i.test(x.textContent) && x.getBoundingClientRect().height > 0); return !!btn; }, s.trouble);
      check(s.at30, s.name + ': at 30 s of a slow backend the page is still waiting (a cold start must not be cut off)');
      check(!loading && trouble && retry, s.name + ': after 46.5 s of a backend that never answers the page must leave "Loading" for #' + s.trouble + ' with a Try again button (loading=' + loading + ', trouble=' + trouble + ', retry=' + retry + ')');
      if (retry) {
        s.stall = false;
        await s.pg.click('#' + s.trouble + ' button');
        await s.pg.waitForTimeout(800);
        check(await shown(s.pg, s.loaded), s.name + ': Try again did not load the page once the backend answered');
      }
      await s.pg.context().close();
    }

    /* 2. a refused submission says what happened and keeps the answers */
    {
      let mode = null;
      const { pg } = await openIntake('desktop', (route) => {
        if (mode === 'neterr') return route.abort('failed');
        if (mode === 404) return send(route, 404, { error: 'This pre-visit link is no longer active.' });
        if (mode === 413) return send(route, 413, { error: 'Submission too large.' });
        if (mode === 500) return send(route, 500, { error: 'Could not save the submission.' });
        if (mode === 502) return send(route, 502, 'Bad Gateway');
        return send(route, 200, { ok: true });
      });
      await fillRequired(pg, '1970-01-01');
      const expect = {
        404: [/no longer active/i, /new link/i, /\(215\) 555-0100/],
        413: [/too long/i, /shorten/i],
        500: [/Could not save the submission/, /still here|kept/i, /try again in a moment/i],
        502: [/did not answer/i, /still here|kept/i, /try again in a moment/i],
        neterr: [/did not answer/i, /still here|kept/i, /try again/i],
      };
      for (const m of [404, 413, 500, 502, 'neterr']) {
        mode = m;
        await submitAndSettle(pg);
        const st = await pg.evaluate(() => ({ err: document.getElementById('formErr').textContent, meds: document.getElementById('meds').value, btn: document.getElementById('submitBtn').textContent, form: !document.getElementById('formWrap').classList.contains('hide') }));
        for (const re of expect[m]) check(re.test(st.err), 'submit ' + m + ': the message must match ' + re + ' - got: "' + st.err + '"');
        check(!/check your entries/i.test(st.err), 'submit ' + m + ': "Check your entries" is wrong advice for this failure - got: "' + st.err + '"');
        check(st.form && st.meds === 'ibuprofen' && /Submit to my care team/.test(st.btn), 'submit ' + m + ': the answers must stay on the form with the button ready again ' + JSON.stringify(st));
      }
      await pg.context().close();
    }

    /* 3. an impossible date of birth is refused by the field, on both widths */
    for (const vp of ['desktop', 'phone']) {
      /* the office refuses these dates too (400 {field:'dob'}), as the backend now does */
      let refuseDob = false;
      const { pg, sent } = await openIntake(vp, (route, d) => (refuseDob || d.dob !== '1970-01-01' ? send(route, 400, { error: 'Please check the date of birth.', field: 'dob' }) : send(route, 200, { ok: true })));
      await fillRequired(pg, '1970-01-01');
      for (const dob of ['2031-05-05', '20255-01-01', '1879-12-31']) {
        await pg.fill('#dob', dob);
        await pg.click('#submitBtn'); await pg.waitForTimeout(400);
        const byField = await pg.evaluate(() => {
          const e = document.getElementById('dobErr'), f = document.getElementById('dob');
          if (!e || e.classList.contains('hide')) return null;
          const a = e.getBoundingClientRect(), c = f.getBoundingClientRect();
          return { text: e.textContent, below: a.top >= c.bottom - 1 && a.top - c.bottom < 40, sameColumn: a.left < c.right && a.right > c.left, invalid: f.getAttribute('aria-invalid') };
        });
        check(sent.length === 0, vp + ' dob ' + dob + ': an impossible date of birth was sent to the office (' + JSON.stringify(sent.map((d) => d.dob)) + ')');
        check(byField && /date of birth/i.test(byField.text) && byField.below && byField.sameColumn && byField.invalid === 'true', vp + ' dob ' + dob + ': the problem must be said right under the date-of-birth field - got ' + JSON.stringify(byField));
        sent.length = 0;
      }
      const scroll = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(scroll <= 0, vp + ': the page scrolls sideways by ' + scroll + 'px with the date-of-birth message shown');
      /* a real date clears it; the server's own dob refusal lands by the field */
      await pg.fill('#dob', '1970-01-01'); await pg.locator('#dob').dispatchEvent('change');
      check(!(await shown(pg, 'dobErr')), vp + ': a real date of birth must clear the message under the field');
      refuseDob = true;
      await submitAndSettle(pg);
      const server = await pg.evaluate(() => { const e = document.getElementById('dobErr'); return e && !e.classList.contains('hide') ? e.textContent : null; });
      check(server === 'Please check the date of birth.', vp + ': the server\'s 400 {field:"dob"} must be shown under the field - got ' + JSON.stringify(server));
      refuseDob = false; sent.length = 0;
      await submitAndSettle(pg);
      check(await shown(pg, 'done'), vp + ': a real date of birth is sent and the intake finishes');
      check(sent.length === 1 && sent[0].dob === '1970-01-01' && sent[0].pain === null, vp + ': the valid submission must carry the date and an untouched pain of null - got ' + JSON.stringify(sent.map((d) => ({ dob: d.dob, pain: d.pain }))));
      await pg.context().close();
    }

    /* 4. the custom-questions header matches the others; 0 pain can be answered */
    for (const vp of ['desktop', 'phone']) {
      const { pg, sent } = await openIntake(vp, (route) => send(route, 200, { ok: true }));
      const heads = await pg.evaluate(() => {
        const std = [...document.querySelectorAll('#ikForm .card.sec h3')].filter((h) => h.id !== 'ikCustomHead').map((h) => getComputedStyle(h).fontSize);
        const c = document.getElementById('ikCustomHead'), cs = getComputedStyle(c);
        return { std, tag: c.tagName, size: cs.fontSize, color: cs.color, stdColor: getComputedStyle(document.querySelector('#ikForm .card.sec h3')).color };
      });
      check(heads.tag === 'H3' && heads.std.every((s) => s === heads.size) && heads.color === heads.stdColor, vp + ': the custom-questions header must be an H3 like the other section headers ' + JSON.stringify(heads));
      await fillRequired(pg, '1970-01-01');
      if (vp === 'phone') {
        await pg.locator('#pain').scrollIntoViewIfNeeded();
        const box = await pg.locator('#pain').boundingBox();
        /* a tap on the slider that does not move it is not an answer (an iPhone
           does not move the thumb for a tap on the track; counting the tap
           recorded an invented 0) */
        await pg.touchscreen.tap(box.x + 6, box.y + box.height / 2); await pg.waitForTimeout(100);
        check((await pg.textContent('#painVal')) === '—', vp + ': a tap that does not move the slider leaves pain unanswered');
        await pg.tap('#painNone');
      } else {
        await pg.focus('#pain'); await pg.keyboard.press('Home'); await pg.keyboard.press('ArrowLeft');
      }
      await pg.waitForTimeout(100);
      const painShown = await pg.textContent('#painVal');
      check(painShown === '0', vp + ': choosing 0 on the pain slider (' + (vp === 'phone' ? 'the No pain (0) button' : 'Home / Left') + ') must read "0" - got "' + painShown + '"');
      await submitAndSettle(pg);
      check(sent.length === 1 && sent[0].pain === 0, vp + ': a pain of 0 must be sent as 0 - got ' + JSON.stringify(sent.map((d) => d.pain)));
      await pg.context().close();
    }

    check(errs.length === 0, 'no page errors: ' + errs.join(' | '));
    assert.deepStrictEqual(problems, [], 'intake defects:\n  - ' + problems.join('\n  - '));
    console.log('PASS intake says what went wrong: a dead link, an over-long form and an office that did not answer each say so and keep the answers; a stalled backend leaves Loading on intake, booking and appointment with a working Try again; an impossible date of birth is refused by the field (and the server\'s refusal too); the custom-questions header matches; and 0 pain can be answered');
  } finally { await b.close(); srv.close(); }
});
