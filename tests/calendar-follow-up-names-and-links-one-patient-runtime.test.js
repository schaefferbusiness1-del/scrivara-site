'use strict';
/* The New-appointment form names and links ONE patient, and the daily brief
   counts only appointments that are still on (bla-1.0.0, 2026-09-25).
   Confirmed in real Chrome against the real backend:
   - #1  With the form open for Dee Sample (syn-3), '📅 Schedule follow-up' for
         Eli Sample (syn-4) wrote Eli's name into the box but kept Dee's chart
         link; the POST was {name:'Eli Sample', patient_external_id:'syn-3'},
         so "Open patient" on that appointment opened Dee's chart.
         calCreateAppt never checked that a stored link matched the name.
   - #5  The 'Visit captured' pop-up and the note Recommendations 'Schedule'
         chip passed the chart id where calScheduleForPatient takes a name, so
         the form read 'syn-2' and the appointment was saved under the id.
   - #7  The daily brief counted a cancelled appointment and named it "Next";
         the Patient list's NEXT glow followed it.
   Real Chromium; nothing leaves 127.0.0.1 (the MLS server is stubbed). */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const USER = { id: 'harness', email: 'ui-harness@mlsscribe.test', role: 'doctor', name: 'Sample Provider, MD', premium: true, hasAccess: true, agreements: { required: false, signerComplete: true } };
const NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample'];

const posts = [];
let apptRows = [];
function answer(url, method, body) {
  const u = String(url);
  if (/\/api\/appointments(\?|$)/.test(u)) {
    if (method === 'POST') { posts.push(body); return { ok: true, appointment: Object.assign({ id: 900 + posts.length }, body) }; }
    return { appointments: apptRows, me: {} };
  }
  if (/\/api\/me(\?|$)/.test(u)) return { user: Object.assign({ access: 'premium' }, USER) };
  if (/\/api\/auth\/me\b/.test(u)) return { user: Object.assign({ totp_enabled: false }, USER) };
  if (/\/api\/auth\/2fa\/status/.test(u)) return { enabled: false };
  if (/\/api\/keys\b/.test(u)) return { keys: [] };
  if (/\/api\/health\b/.test(u)) return { ok: true };
  if (/\/api\/agreements\/me(\?|$)/.test(u)) return { signed: true, version: '2026-06-10' };
  if (/\/api\/prefs(\?|$)/.test(u)) return { prefs: {} };
  return null;
}

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
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'America/New_York', locale: 'en-US' });
    await ctx.addInitScript(() => { try { sessionStorage.setItem('sf_session', 'ui-harness@mlsscribe.test'); sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const req = r.request();
      let body = null; try { body = req.postDataJSON(); } catch (e) {}
      const a = answer(req.url(), req.method(), body);
      return a ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) }) : r.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate((user) => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
      try { bkUser = user; } catch (e) {}
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
    }, USER);
    await pg.waitForFunction(() => !!window.__mlsCascade && !!window.__mlsRecs && !!window.__mlsR3PackB40 && !!(window._renderDailyBrief && window._renderDailyBrief.__r3), null, { timeout: 60000 });
    /* a signed-in session raises its first-run questions over everything; answer them */
    for (let i = 0; i < 12; i++) {
      await pg.evaluate(() => {
        const bs = [...document.querySelectorAll('button')].filter((x) => x.offsetParent);
        const f = bs.find((x) => /Use faster day-only pulls/.test(x.textContent)); if (f) f.click();
        const m = bs.find((x) => /^No, it is mine$/.test(x.textContent.trim())); if (m) m.click();
        const l = bs.find((x) => /^Later$/.test(x.textContent.trim())); if (l) l.click();
      });
      await pg.waitForTimeout(250);
    }
    const seeded = await pg.evaluate((NAMES) => {
      savePatients(NAMES.map((n, i) => ({ id: 'syn-' + i, name: n, dob: '1970-01-0' + (i + 1), mrn: 'MRN' + (100000 + i), phone: '555-010' + i, notes: [], visits: [] })));
      try { renderPatients(); } catch (e) {}
      return getPatients().map((p) => p.id + '=' + p.name);
    }, NAMES);
    assert.strictEqual(seeded.length, 5, 'five synthetic charts: ' + JSON.stringify(seeded));

    const select = async (id) => {
      const got = await pg.evaluate((id) => { selectPatient(id); return getActivePtId(); }, id);
      assert.strictEqual(got, id, 'the active chart is ' + id);
    };
    const form = () => pg.evaluate(() => {
      const box = document.getElementById('calNewApptBox');
      const v = (id) => { const e = document.getElementById(id); return e ? e.value : null; };
      return { open: !!box && box.style.display !== 'none', name: v('calNewName'), ext: v('calNewExtId'), phone: v('calNewPhone'), time: v('calNewTime'),
        badge: ((document.getElementById('calNewLinkInd') || {}).textContent || '').trim(), msg: ((document.getElementById('calNewMsg') || {}).textContent || '').trim() };
    });
    const closeForm = () => pg.evaluate(() => { const x = document.getElementById('calNewApptBox'); if (x) { x.style.display = 'none'; x.innerHTML = ''; } });
    /* each finding is its own section, so one run shows every finding's result */
    const failed = [];
    const section = async (label, fn) => {
      try { await fn(); console.log('ok   ' + label); }
      catch (e) { failed.push(label); console.log('FAIL ' + label + ' :: ' + String(e && e.message || e).slice(0, 400)); }
      await closeForm();
    };
    const pressSchedule = async () => {
      const before = posts.length;
      await pg.evaluate(() => { const x = [...document.querySelectorAll('#calNewApptBox button')].find((e) => /Schedule it/.test(e.textContent)); x.click(); });
      await pg.waitForTimeout(1200);
      return posts.slice(before);
    };

    /* ---- #1: the open form is re-linked to the new patient ------------- */
    await section('#1 an open form is re-linked to the next patient', async () => {
    await select('syn-3');
    await pg.evaluate(() => calScheduleForPatient());
    await pg.waitForTimeout(600);
    const dee = await form();
    assert.ok(dee.open && dee.name === 'Dee Sample' && dee.ext === 'syn-3' && /Dee Sample/.test(dee.badge), 'the form opens for Dee, linked to Dee\'s chart: ' + JSON.stringify(dee));
    await pg.fill('#calNewTime', '10:30');
    await select('syn-4');
    await pg.evaluate(() => calScheduleForPatient());
    await pg.waitForTimeout(600);
    const eli = await form();
    assert.strictEqual(eli.name, 'Eli Sample', 'the form names Eli: ' + JSON.stringify(eli));
    assert.strictEqual(eli.ext, 'syn-4', 'the form is linked to Eli\'s chart, not Dee\'s: ' + JSON.stringify(eli));
    assert.ok(/linked to Eli Sample/.test(eli.badge) && !/Dee/.test(eli.badge), 'the link badge names Eli: ' + JSON.stringify(eli));
    assert.ok(eli.phone !== '555-0103', 'Dee\'s phone does not carry over to Eli\'s form: ' + JSON.stringify(eli));
    await pg.fill('#calNewTime', '11:15');
    const eliPost = await pressSchedule();
    assert.strictEqual(eliPost.length, 1, 'one appointment is sent: ' + JSON.stringify(eliPost));
    assert.strictEqual(eliPost[0].name, 'Eli Sample');
    assert.strictEqual(eliPost[0].patient_external_id, 'syn-4', 'Eli\'s appointment is saved on Eli\'s chart: ' + JSON.stringify(eliPost[0]));
    });

    /* the same patient again keeps what was typed */
    await section('#1 the same patient keeps the open form', async () => {
    await select('syn-4');
    await pg.evaluate(() => calScheduleForPatient());
    await pg.waitForTimeout(600);
    await pg.fill('#calNewTime', '09:45');
    await pg.evaluate(() => calScheduleForPatient());
    await pg.waitForTimeout(600);
    const again = await form();
    assert.ok(again.open && again.name === 'Eli Sample' && again.ext === 'syn-4' && again.time === '09:45', 'the same patient keeps the open form and its time: ' + JSON.stringify(again));
    });

    /* #1: calCreateAppt refuses a link whose chart name is not the name typed */
    await section('#1 calCreateAppt refuses a link to another name\'s chart', async () => {
    await select('syn-3');
    await pg.evaluate(() => calScheduleForPatient());
    await pg.waitForTimeout(600);
    await pg.fill('#calNewTime', '14:00');
    await pg.evaluate(() => { document.getElementById('calNewName').value = 'Eli Sample'; });   /* a write in code fires no input event */
    const refused = await pressSchedule();
    const afterRefuse = await form();
    assert.deepStrictEqual(refused, [], 'a link to Dee\'s chart under Eli\'s name is not saved: ' + JSON.stringify(refused));
    assert.ok(/Nothing was saved/.test(afterRefuse.msg) && /Dee Sample/.test(afterRefuse.msg), 'the form says why nothing was saved: ' + JSON.stringify(afterRefuse));
    assert.strictEqual(afterRefuse.ext, 'syn-4', 'the link is worked out again from the name: ' + JSON.stringify(afterRefuse));
    const second = await pressSchedule();
    assert.ok(second.length === 1 && second[0].name === 'Eli Sample' && second[0].patient_external_id === 'syn-4', 'the next press saves Eli on Eli\'s chart: ' + JSON.stringify(second));
    });

    /* ---- #5: the Visit-captured pop-up fills the NAME ------------------ */
    await section('#5 the Visit-captured pop-up fills the name', async () => {
    await select('syn-2');
    await pg.evaluate(() => window.__mlsCascade.show());
    await pg.waitForSelector('#mlsCascade [data-a="followup"]', { timeout: 5000 });
    await pg.click('#mlsCascade [data-a="followup"]');
    await pg.waitForTimeout(700);
    const cas = await form();
    assert.strictEqual(cas.name, 'Cy Sample', 'the pop-up\'s Schedule follow-up fills Cy\'s name, not the chart id: ' + JSON.stringify(cas));
    assert.strictEqual(cas.ext, 'syn-2', 'and links Cy\'s chart: ' + JSON.stringify(cas));
    await pg.fill('#calNewTime', '13:00');
    const casPost = await pressSchedule();
    assert.ok(casPost.length === 1 && casPost[0].name === 'Cy Sample' && casPost[0].patient_external_id === 'syn-2', 'the saved appointment is named Cy Sample: ' + JSON.stringify(casPost));
    });

    /* #5: the Recommendations 'Schedule' chip fills the NAME too */
    await section('#5 the Recommendations Schedule chip fills the name', async () => {
    await select('syn-2');
    const hasEditor = await pg.evaluate(() => {
      const txt = 'Assessment and plan: lumbar radiculopathy. MRI lumbar spine ordered. Follow up in 6 weeks for re-evaluation after the injection series is complete.';
      const live = document.getElementById('noteBox') || document.getElementById('noteText') || document.getElementById('clinicalNote');
      if (!live) return false;
      if ('value' in live) live.value = txt; else live.textContent = txt;
      return true;
    });
    assert.ok(hasEditor, 'the visit note editor exists');
    await pg.evaluate(() => window.__mlsRecs.open());
    await pg.waitForSelector('#mlsRecOverlay [data-act="schedule"]', { timeout: 5000 });
    await pg.click('#mlsRecOverlay [data-act="schedule"]');
    await pg.waitForTimeout(700);
    const rec = await form();
    assert.ok(rec.name === 'Cy Sample' && rec.ext === 'syn-2', 'the Recommendations chip fills Cy\'s name and links Cy\'s chart: ' + JSON.stringify(rec));
    });

    /* #5: a caller that still passes only the chart id gets the chart's name */
    await section('#5 an id-only call resolves to the chart\'s name', async () => {
    await select('syn-0');
    await pg.evaluate(() => calScheduleForPatient('syn-2'));
    await pg.waitForTimeout(600);
    const legacy = await form();
    assert.ok(legacy.name === 'Cy Sample' && legacy.ext === 'syn-2', 'an id-only call is resolved to that chart\'s name: ' + JSON.stringify(legacy));
    });
    /* a free name that is no chart stays a new, unlinked name */
    await section('#5 a free name links no chart', async () => {
    await pg.evaluate(() => calScheduleForPatient('Walk In Person'));
    await pg.waitForTimeout(600);
    const free = await form();
    assert.ok(free.name === 'Walk In Person' && free.ext === '' && free.phone === '', 'a free name links no chart and carries no other chart\'s phone: ' + JSON.stringify(free));
    });

    /* ---- #7: the daily brief skips cancelled and no-show rows ---------- */
    await section('#7 the daily brief skips cancelled and no-show appointments', async () => {
    const brief = await pg.evaluate(async () => {
      const today = _acctTodayKey();
      const at = (m) => new Date(Date.now() + m * 60000).toISOString();
      window._calAppts = [
        { id: 1, name: 'Ada Sample', appt_date: today, start_at: at(15), status: 'cancelled', patient_external_id: 'syn-0' },
        { id: 2, name: 'Cy Sample', appt_date: today, start_at: at(25), status: 'no_show', patient_external_id: 'syn-2' },
        { id: 3, name: 'Bo Sample', appt_date: today, start_at: at(50), status: 'booked', patient_external_id: 'syn-1' }
      ];
      await window._renderDailyBrief();
      const bar = document.getElementById('dailyBriefBar');
      return { text: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null, next: bar ? bar.getAttribute('data-next-patient') : null };
    });
    assert.ok(/\b1 appointment today\b/.test(brief.text), 'the brief counts only the booked appointment: ' + JSON.stringify(brief));
    assert.ok(/Next: Bo Sample at/.test(brief.text) && !/Ada Sample|Cy Sample/.test(brief.text), 'Next names the booked patient, never a cancelled or no-show one: ' + JSON.stringify(brief));
    assert.strictEqual(brief.next, 'syn-1', 'the NEXT glow follows the booked patient: ' + JSON.stringify(brief));
    const allGone = await pg.evaluate(async () => {
      window._calAppts = window._calAppts.filter((a) => a.status !== 'booked');
      await window._renderDailyBrief();
      const bar = document.getElementById('dailyBriefBar');
      return { shown: !!bar && bar.style.display !== 'none', next: bar && bar.getAttribute('data-next-patient') };
    });
    assert.ok(!allGone.shown && !allGone.next, 'a day whose appointments are all cancelled or no-show shows no brief and no Next: ' + JSON.stringify(allGone));
    });

    /* the shell's own brief (the fallback under the wrapper) counts the same way */
    await section('#7 the shell brief skips cancelled appointments', async () => {
    apptRows = [
      { id: 11, name: 'Ada Sample', status: 'cancelled' },
      { id: 12, name: 'Bo Sample', status: 'booked' },
      { id: 13, name: 'Cy Sample', status: 'checked_in' }
    ];
    const shell = await pg.evaluate(async () => {
      window.__mlsR3PackB40_revert();
      if (window._renderDailyBrief.__r3) return { err: 'the wrapper is still installed' };
      await window._renderDailyBrief();
      const bar = document.getElementById('dailyBriefBar');
      return { text: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null };
    });
    assert.ok(/\b2 appointments today\b/.test(shell.text || ''), 'the shell brief does not count the cancelled row: ' + JSON.stringify(shell));
    });

    assert.deepStrictEqual(failed, [], 'every section passes: ' + JSON.stringify(failed));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS calendar follow-up names and links one patient: an open form is rebuilt for the next patient with that patient\'s chart link, a link whose chart name is not the typed name is refused, the Visit-captured and Recommendations follow-ups fill the patient\'s name, an id-only call resolves to the chart\'s name, and the daily brief counts no cancelled or no-show appointment and never names one as Next');
  } finally { await b.close(); srv.close(); }
});
