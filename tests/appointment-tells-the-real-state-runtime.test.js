'use strict';
/* The patient appointment page tells the real state of the visit (pagesfix-1.0.0).
   Found by the patient-pages hunt on appointment.html:
   - a visit that already took place (completed / no-show / checked in / roomed)
     or whose time had passed still read "Requested" with "Confirm I'll be
     there" and "Cancel this appointment" - buttons the server refuses;
   - confirming an appointment the office had cancelled meanwhile said "Could
     not confirm. Please try again." and threw away the server's 409 reason,
     offering a retry that could never work;
   - an appointment already cancelled when the link opened said "We've let the
     office know" even when the office cancelled it, and the cancel prompt said
     'Tap "Cancel" once more' next to a button reading "Need to cancel?".
   Real Chrome; the API is stubbed with page.route; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PT = 'p'.repeat(48);
const PHONE = '(215) 555-0100';
const appt = (o) => Object.assign({ name: 'Pat Testpatient', when: 'Monday, October 5, 2026 at 10:00 AM', date: '2026-10-05', provider: 'Dr. Ada Test',
  practice: 'Test Spine Practice', practice_phone: PHONE, status: 'booked', confirmed: false, closed: false, reason: 'Back pain', tz: 'America/New_York' }, o || {});
const VP = { desktop: { viewport: { width: 1400, height: 900 } }, phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  /* api(key) -> [status, body] | 'abort'; key is "GET /" , "POST /confirm", "POST /cancel" */
  const open = async (api, vp) => {
    const ctx = await b.newContext(VP[vp || 'desktop']);
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.route(/\/api\/appointments\/public\//, (route) => {
      const req = route.request(), u = new URL(req.url());
      const key = req.method() + ' ' + (u.pathname.replace(/^.*\/api\/appointments\/public\/[^/]+/, '') || '/');
      const h = api(key);
      if (h === 'abort') return route.abort('failed');
      if (!h) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' });
      return route.fulfill({ status: h[0], contentType: 'application/json', headers: { 'access-control-allow-origin': req.headers()['origin'] || '*' }, body: JSON.stringify(h[1]) });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/appointment.html?t=' + PT, { waitUntil: 'load' });
    await pg.waitForFunction(() => document.getElementById('loading').classList.contains('hide'), null, { timeout: 15000 });
    await pg.waitForTimeout(150);
    return pg;
  };
  const state = (pg) => pg.evaluate(() => {
    const on = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const panel = ['loading', 'notfound', 'offline', 'reopen', 'view', 'cancelled'].filter((id) => !document.getElementById(id).classList.contains('hide'));
    const buttons = Array.from(document.querySelectorAll('#view button')).filter(on).map((x) => x.textContent.trim());
    const err = document.getElementById('apptErr');
    return { panel: panel.join(','), pill: document.getElementById('statusPill').textContent.trim(), buttons,
      text: (document.querySelector('.wrap') || document.body).innerText, err: on(err) ? err.textContent.trim() : '',
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  });
  try {
    /* 1. a visit that already took place, or whose time passed, offers no confirm / cancel */
    const PAST = [
      ['completed', /already taken place/i],
      ['done', /already taken place/i],
      ['no_show', /time has passed/i],
      ['checked_in', /checked in/i],
      ['roomed', /checked in/i],
      ['booked', /time has passed/i],
    ];
    for (const vp of ['desktop', 'phone']) {
      for (const [status, want] of PAST) {
        const pg = await open((key) => key === 'GET /' ? [200, { ok: true, appointment: appt({ status, closed: true, when: 'Monday, September 14, 2026 at 10:00 AM', date: '2026-09-14' }) }] : null, vp);
        const s = await state(pg);
        const tag = vp + ' ' + status + ': ' + JSON.stringify({ panel: s.panel, pill: s.pill, buttons: s.buttons });
        assert.strictEqual(s.panel, 'view', 'a past visit still shows its details - ' + tag);
        assert.notStrictEqual(s.pill, 'Requested', 'a past visit is not labelled "Requested" - ' + tag);
        assert.ok(!s.buttons.some((x) => /confirm|cancel/i.test(x)), 'a past visit offers no Confirm / Cancel buttons - ' + tag);
        assert.match(s.text, want, 'a past visit says what happened - ' + tag + ' ' + s.text);
        assert.ok(s.text.includes(PHONE), 'a past visit gives the office phone - ' + tag);
        assert.ok(s.scrollW <= s.clientW, 'no sideways scroll on ' + vp + ' (' + s.scrollW + ' > ' + s.clientW + ')');
        await pg.context().close();
      }
    }
    /* a confirmed appointment whose time passed does not offer "Need to cancel?" */
    {
      const pg = await open((key) => key === 'GET /' ? [200, { ok: true, appointment: appt({ confirmed: true, closed: true }) }] : null);
      const s = await state(pg);
      assert.ok(!s.buttons.some((x) => /cancel/i.test(x)), 'a confirmed but past appointment offers no cancel: ' + JSON.stringify(s.buttons));
      assert.match(s.text, /time has passed/i, 'and says the time has passed');
      assert.ok(!/You're confirmed\. We look forward/.test(s.text), 'and does not say "we look forward to seeing you"');
      await pg.context().close();
    }
    /* the ordinary open appointment is unchanged */
    {
      const pg = await open((key) => key === 'GET /' ? [200, { ok: true, appointment: appt() }] : null, 'phone');
      const s = await state(pg);
      assert.strictEqual(s.pill, 'Requested', 'an open, unconfirmed appointment still reads Requested');
      assert.deepStrictEqual(s.buttons, ["Confirm I'll be there", 'Cancel this appointment'], 'and still offers both buttons');
      await pg.context().close();
    }

    /* 2. confirming an appointment the office cancelled meanwhile: the real state, no pointless retry */
    const REASON = 'This appointment was cancelled. Call the office to rebook.';
    {
      let cancelledNow = false;
      const pg = await open((key) => {
        if (key === 'GET /') return [200, { ok: true, appointment: appt({ status: cancelledNow ? 'cancelled' : 'booked' }) }];
        if (key === 'POST /confirm') { cancelledNow = true; return [409, { ok: false, error: REASON }]; }
        return null;
      });
      await pg.click('#confirmBtn'); await pg.waitForTimeout(700);
      const s = await state(pg);
      assert.ok(!/Could not confirm\. Please try again/.test(s.text), 'a 409 is not "Please try again": ' + s.text);
      assert.strictEqual(s.panel, 'cancelled', 'the page refreshes to the real (cancelled) state: ' + s.panel);
      assert.ok(!/We've let the office know/.test(s.text), 'an office cancellation is not "we\'ve let the office know": ' + s.text);
      assert.ok(s.text.includes(PHONE), 'the cancelled panel gives the office phone');
      await pg.context().close();
    }
    /* ...and when the refresh itself fails, the server's own words stay, with no retry button */
    {
      let gets = 0;
      const pg = await open((key) => {
        if (key === 'GET /') return ++gets === 1 ? [200, { ok: true, appointment: appt() }] : 'abort';
        if (key === 'POST /confirm') return [409, { ok: false, error: REASON }];
        return null;
      });
      await pg.click('#confirmBtn'); await pg.waitForTimeout(700);
      const s = await state(pg);
      assert.strictEqual(s.err, REASON, 'the server\'s 409 reason is shown as written: ' + JSON.stringify(s.err));
      assert.ok(!s.buttons.some((x) => /confirm/i.test(x)), 'no Confirm retry after a 409: ' + JSON.stringify(s.buttons));
      await pg.context().close();
    }
    /* other 4xx replies carry text written for patients - show it */
    {
      const pg = await open((key) => {
        if (key === 'GET /') return [200, { ok: true, appointment: appt() }];
        if (key === 'POST /confirm') return [400, { ok: false, error: 'Please call the office to confirm this visit.' }];
        return null;
      });
      await pg.click('#confirmBtn'); await pg.waitForTimeout(500);
      const s = await state(pg);
      assert.strictEqual(s.err, 'Please call the office to confirm this visit.', 'a 4xx reason is shown as written: ' + JSON.stringify(s.err));
      await pg.context().close();
    }
    /* a 5xx is still transient and retryable */
    {
      const pg = await open((key) => {
        if (key === 'GET /') return [200, { ok: true, appointment: appt() }];
        if (key === 'POST /confirm') return [500, {}];
        return null;
      });
      await pg.click('#confirmBtn'); await pg.waitForTimeout(500);
      const s = await state(pg);
      assert.match(s.err, /try again/i, 'a 5xx still offers a retry: ' + s.err);
      assert.ok(s.buttons.includes("Confirm I'll be there"), 'and the Confirm button is back');
      await pg.context().close();
    }
    /* cancelling a visit whose time passed: the server's reason, no buttons */
    {
      const PASSED = 'This appointment time has passed. Call the office if something needs to change.';
      let passed = false;
      const pg = await open((key) => {
        if (key === 'GET /') return [200, { ok: true, appointment: appt({ closed: passed }) }];
        if (key === 'POST /cancel') { passed = true; return [409, { ok: false, error: PASSED }]; }
        return null;
      });
      await pg.click('#confirmWrap .btn.ghost'); await pg.waitForTimeout(800);
      await pg.click('#confirmWrap .btn.ghost'); await pg.waitForTimeout(700);
      const s = await state(pg);
      assert.ok(!/Could not cancel/.test(s.text), 'a 409 on cancel is not "Could not cancel": ' + s.text);
      assert.match(s.text, /time has passed/i, 'the page says the time has passed');
      assert.ok(!s.buttons.some((x) => /confirm|cancel/i.test(x)), 'and offers no buttons: ' + JSON.stringify(s.buttons));
      await pg.context().close();
    }

    /* 3. cancelled when the link opened: not "we've let the office know" */
    {
      const pg = await open((key) => key === 'GET /' ? [200, { ok: true, appointment: appt({ status: 'cancelled' }) }] : null, 'phone');
      const s = await state(pg);
      assert.strictEqual(s.panel, 'cancelled');
      assert.ok(!/We've let the office know/.test(s.text), 'an appointment cancelled before the page opened does not claim the patient just told the office: ' + s.text);
      assert.match(s.text, /cancelled/i);
      assert.ok(s.text.includes(PHONE), 'it gives the office phone');
      await pg.context().close();
    }

    /* 4. the cancel prompt names the button the patient actually sees; a real cancel does tell the office */
    for (const [label, sel, conf] of [['unconfirmed', '#confirmWrap .btn.ghost', false], ['confirmed', '#confirmedMsg .btn.ghost', true]]) {
      let cancels = 0;
      const pg = await open((key) => {
        if (key === 'GET /') return [200, { ok: true, appointment: appt({ confirmed: conf }) }];
        if (key === 'POST /cancel') { cancels++; return [200, { ok: true }]; }
        return null;
      });
      await pg.click(sel); await pg.waitForTimeout(200);
      const armed = await pg.evaluate((sel) => ({ btn: document.querySelector(sel).textContent.trim(), prompt: document.getElementById('apptErr').textContent.trim() }), sel);
      const quoted = (armed.prompt.match(/[“"]([^”"]+)[”"]/) || [])[1];
      assert.ok(quoted, label + ': the prompt names a button: ' + armed.prompt);
      assert.strictEqual(quoted, armed.btn, label + ': the prompt names the button on screen: ' + JSON.stringify(armed));
      assert.strictEqual(cancels, 0, label + ': one tap does not cancel');
      await pg.waitForTimeout(700);
      await pg.click(sel); await pg.waitForTimeout(600);
      const s = await state(pg);
      assert.strictEqual(cancels, 1, label + ': the second deliberate tap cancels');
      assert.strictEqual(s.panel, 'cancelled');
      assert.match(s.text, /We've let the office know/, label + ': a cancel from this page does say the office was told');
      await pg.context().close();
    }
    /* a cancel that finds it already cancelled (already:true) told the office nothing */
    {
      const pg = await open((key) => {
        if (key === 'GET /') return [200, { ok: true, appointment: appt() }];
        if (key === 'POST /cancel') return [200, { ok: true, already: true }];
        return null;
      });
      await pg.click('#confirmWrap .btn.ghost'); await pg.waitForTimeout(700);
      await pg.click('#confirmWrap .btn.ghost'); await pg.waitForTimeout(600);
      const s = await state(pg);
      assert.strictEqual(s.panel, 'cancelled');
      assert.ok(!/We've let the office know/.test(s.text), 'an already-cancelled appointment does not claim the office was just told: ' + s.text);
      await pg.context().close();
    }
    /* the armed label goes back when the window closes */
    {
      const pg = await open((key) => key === 'GET /' ? [200, { ok: true, appointment: appt() }] : null);
      await pg.click('#confirmWrap .btn.ghost'); await pg.waitForTimeout(6600);
      const back = await pg.evaluate(() => ({ btn: document.querySelector('#confirmWrap .btn.ghost').textContent.trim(), err: document.getElementById('apptErr').className }));
      assert.strictEqual(back.btn, 'Cancel this appointment', 'the cancel button reads normally again after 6 seconds');
      assert.match(back.err, /hide/, 'and the prompt clears');
      await pg.context().close();
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS appointment page tells the real state: past visits say so with the office phone and no confirm/cancel, a 409 shows the server\'s reason and refreshes to the real state, an office cancellation is not "we\'ve let the office know", and the cancel prompt names the button on screen');
  } finally { await b.close(); srv.close(); }
});
