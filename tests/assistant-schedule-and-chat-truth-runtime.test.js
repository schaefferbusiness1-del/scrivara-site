'use strict';
/* The MLS Assistant panel shows the right chart and the real conversation
   (stafffix-1.0.0, 2026-09-23). Found by the Copilot hunt on the signed-in 1p
   shell:
   - Schedule tab: an appointment for the 1990 "Ada Sample" (exact MLS id +
     an athenaOne MM/DD/YYYY DOB) showed, and on a tap opened, the 1960 Ada's
     chart. The panel keyed charts by a field local charts never carry,
     compared raw DOB strings and fell back to the first same-name chart, so a
     row the shell's own resolver refuses still borrowed a chart. It now asks
     _calResolveLocalPatient; a row with no chart reads "not in MLS yet" and
     opens nothing.
   - Schedule tab: "Op-note candidates" skipped every medial branch block and
     radiofrequency ablation (and plurals), so a block day read 0.
   - Chat tab: Schedule->Chat, or closing and reopening the panel, painted the
     panel's own greeting over the shared conversation while that hidden
     conversation was still sent as history with the next question.
   Real Chrome at 1400x900 and 390x844; the AI is stubbed and nothing leaves
   127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';

const DESK = { viewport: { width: 1400, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.__copilot = [];
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/copilot') {
        const body = JSON.parse(r.request().postData() || '{}');
        pg.__copilot.push(body);
        return r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ reply: 'STUB REPLY ' + pg.__copilot.length, actions: [], followups: [] }) });
      }
      return r.fulfill({ status: 503, body: 'x' });
    });
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
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.waitForTimeout(800);
    await pg.evaluate(() => {
      window.hasAI = () => true;
      window.aiCallRaw = async () => 'STUB AI';
      /* a second, different patient named like syn-0 (Ada Sample, DOB 1960-01-01) */
      const ps = getPatients();
      ps.push({ id: 'syn-dup', name: 'Ada Sample', dob: '1990-05-05', mrn: 'MRN555555', athenaId: '955555', notes: [], visits: [] });
      savePatients(ps);
      const at = (d, h) => d + 'T' + h + ':00:00Z';
      const dobOf = (i) => { const d = '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1); return d.slice(5, 7) + '/' + d.slice(8, 10) + '/' + d.slice(0, 4); };
      const names = ['Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample', 'Gus Sample', 'Hal Sample'];
      const reasons = ['Lumbar medial branch block', 'Radiofrequency ablation, lumbar facet',
        'Right L4-L5 transforaminal epidural steroid injection', 'Sacroiliac joint injection',
        'Trigger point injections', 'New patient consult'];
      window._calAppts = [
        /* the 1990 Ada: exact MLS id + athenaOne MM/DD/YYYY DOB */
        { id: 'st-dup', name: 'Ada Sample', patient_external_id: 'syn-dup', dob: '05/05/1990', appt_date: '2026-10-05', start_at: at('2026-10-05', '14'), reason: 'Lumbar medial branch block', provider: 'Sample Provider, MD' },
        /* no DOB/MRN: the shell refuses both, so neither may borrow a chart */
        { id: 'st-nodob', name: 'Ada Sample', patient_external_id: 'syn-dup', appt_date: '2026-10-06', start_at: at('2026-10-06', '14'), reason: 'Radiofrequency ablation, lumbar facet', provider: 'Sample Provider, MD' },
        { id: 'st-sole', name: 'Bo Sample', appt_date: '2026-10-06', start_at: at('2026-10-06', '15'), reason: 'Trigger point injections', provider: 'Sample Provider, MD' }
      ].concat(names.map((n, k) => ({ id: 'st-op' + k, name: n, dob: dobOf(k + 2), appt_date: '2026-10-07',
        start_at: at('2026-10-07', String(12 + k)), reason: reasons[k], provider: 'Sample Provider, MD' })));
    });
    return pg;
  };

  const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll('#mlsAsstPanel .as-list .as-pcard')].map((c) => ({
    id: c.getAttribute('data-id'), out: c.classList.contains('is-out'), disabled: !!c.disabled, text: c.innerText.replace(/\s+/g, ' ').trim() })));
  const tiles = (pg) => pg.evaluate(() => ({
    pts: document.querySelector('#mlsAsstPanel .as-stat-pt b').textContent,
    op: document.querySelector('#mlsAsstPanel .as-stat-op b').textContent }));
  const showDay = async (pg, day) => {
    await pg.evaluate((d) => { window.__mlsAsst.open(); window.__mlsAsst.setTab('schedule'); window.__mlsAsst.setDate(d); }, day);
    await pg.waitForTimeout(400);
  };
  const active = (pg) => pg.evaluate(() => { const p = activePatient(); return p ? p.id : null; });

  async function schedule(pg, label, withCounts) {
    /* 1. the appointment's own chart, found through the shell's resolver */
    await showDay(pg, '2026-10-05');
    const d1 = await rows(pg);
    const shell = await pg.evaluate(() => String(_calResolveLocalPatient(Object.assign({}, window._calAppts[0]))));
    assert.strictEqual(shell, 'syn-dup', label + ': the shell resolves the appointment to the 1990 Ada');
    assert.strictEqual(d1.length, 1, label + ': one row for the day: ' + JSON.stringify(d1));
    assert.strictEqual(d1[0].id, 'syn-dup', label + ': the row is the chart the appointment names, not the first same-name chart: ' + JSON.stringify(d1));
    assert.ok(/DOB 1990-05-05/.test(d1[0].text) && !/1960/.test(d1[0].text), label + ': the row shows the 1990 DOB: ' + d1[0].text);
    await pg.locator('#mlsAsstPanel .as-list .as-pcard').first().click();
    await pg.waitForTimeout(800);
    assert.strictEqual(await active(pg), 'syn-dup', label + ': a tap opens the 1990 Ada, the chart the appointment is for');

    /* 2. no chart the shell can prove: the row says so and opens nothing */
    await pg.evaluate(async () => { window.__mlsPatientLock.switchAsDoctor('syn-2'); await new Promise((r) => setTimeout(r, 400)); });
    await showDay(pg, '2026-10-06');
    const d2 = await rows(pg);
    assert.strictEqual(d2.length, 2, label + ': both appointments stay on the day: ' + JSON.stringify(d2));
    for (const r of d2) {
      assert.ok(r.out && r.id === null && r.disabled, label + ': a row with no proven chart names no chart and cannot be pressed: ' + JSON.stringify(r));
      assert.ok(/not in MLS yet/.test(r.text) && !/Select|saved to athenaOne/.test(r.text), label + ': the row reads "not in MLS yet": ' + r.text);
    }
    await pg.locator('#mlsAsstPanel .as-list .as-pcard').first().click({ force: true });
    await pg.waitForTimeout(600);
    assert.strictEqual(await active(pg), 'syn-2', label + ': tapping a "not in MLS yet" row never switches to a same-name chart');
    const hd = await pg.evaluate(() => document.querySelector('#mlsAsstPanel .as-listhd').textContent);
    assert.ok(/2 not in MLS yet/.test(hd), label + ': the day heading counts the rows not in MLS yet: ' + hd);
    if (withCounts) {
      assert.deepStrictEqual(await tiles(pg), { pts: '2', op: '2' }, label + ': an RFA and trigger point injections are op-note candidates');

      /* 3. a pain-procedure day counts its procedures */
      await showDay(pg, '2026-10-07');
      const d3 = await rows(pg);
      assert.deepStrictEqual(d3.map((r) => r.id), ['syn-2', 'syn-3', 'syn-4', 'syn-5', 'syn-6', 'syn-7'],
        label + ': MM/DD/YYYY appointment DOBs match their charts: ' + JSON.stringify(d3));
      assert.deepStrictEqual(await tiles(pg), { pts: '6', op: '5' },
        label + ': blocks, ablations, epidurals, injections count; a consult does not');
    }
  }

  async function chat(pg, label) {
    const thread = () => pg.evaluate(() => (document.querySelector('#mlsAsstPanel .as-thread') || {}).innerText || '');
    await pg.evaluate(async () => {
      sessionStorage.setItem('sf_bk_token', 'harness-token');
      window.__mlsPatientLock.switchAsDoctor('syn-0');
      await new Promise((r) => setTimeout(r, 400));
      window.__mlsAsst.open();
    });
    await pg.locator('#mlsAsstPanel .as-tab[data-tab=chat]').click();
    await pg.waitForFunction(() => !!document.querySelector('#mlsAsstPanel .as-send[data-mlsfix-bound]'), null, { timeout: 20000 });
    const ta = pg.locator('#mlsAsstPanel .as-input textarea');
    await ta.fill('Does Ada have allergies?'); await ta.press('Enter');
    await pg.waitForFunction(() => /STUB REPLY 1/.test(document.querySelector('#mlsAsstPanel .as-thread').innerText), null, { timeout: 15000 });

    await pg.locator('#mlsAsstPanel .as-tab[data-tab=schedule]').click(); await pg.waitForTimeout(300);
    await pg.locator('#mlsAsstPanel .as-tab[data-tab=chat]').click(); await pg.waitForTimeout(500);
    let t = await thread();
    assert.ok(/Does Ada have allergies\?/.test(t) && /STUB REPLY 1/.test(t), label + ': Schedule->Chat still shows the conversation: ' + t.slice(0, 200));

    await pg.locator('#mlsAsstPanel .as-x').click(); await pg.waitForTimeout(300);
    await pg.evaluate(() => window.__mlsAsst.open()); await pg.waitForTimeout(500);
    t = await thread();
    assert.ok(/Does Ada have allergies\?/.test(t) && /STUB REPLY 1/.test(t), label + ': a reopened panel still shows the conversation: ' + t.slice(0, 200));

    await ta.fill('And meds?'); await ta.press('Enter');
    await pg.waitForFunction(() => /STUB REPLY 2/.test(document.querySelector('#mlsAsstPanel .as-thread').innerText), null, { timeout: 15000 });
    const last = pg.__copilot[pg.__copilot.length - 1];
    t = await thread();
    const shown = ['Does Ada have allergies?', 'STUB REPLY 1', 'And meds?', 'STUB REPLY 2'].map((s) => t.indexOf(s));
    assert.ok(shown.every((i, k) => i >= 0 && (k === 0 || i > shown[k - 1])), label + ': the thread shows every turn in order: ' + t.slice(0, 300));
    assert.deepStrictEqual((last.history || []).map((h) => h.text), ['Does Ada have allergies?', 'STUB REPLY 1'],
      label + ': the history sent is the conversation on screen');

    /* the newest turn is in view after Schedule->Chat (the pane used to keep
       the Schedule tab's scroll offset) */
    await pg.locator('#mlsAsstPanel .as-tab[data-tab=schedule]').click(); await pg.waitForTimeout(300);
    await pg.evaluate(() => { const b = document.querySelector('#mlsAsstPanel .as-body'); if (b) b.scrollTop = 0; });
    await pg.locator('#mlsAsstPanel .as-tab[data-tab=chat]').click(); await pg.waitForTimeout(500);
    const inView = await pg.evaluate(() => {
      const body = document.querySelector('#mlsAsstPanel .as-body');
      const all = document.querySelectorAll('#mlsAsstPanel .as-thread > *');
      const lastEl = all[all.length - 1];
      if (!body || !lastEl) return 'missing';
      const b = body.getBoundingClientRect(), r = lastEl.getBoundingClientRect();
      return r.bottom <= b.bottom + 2 && r.bottom > b.top;
    });
    assert.strictEqual(inView, true, label + ': the newest turn is in view after Schedule->Chat');

    /* after a session boundary on this tab the Chat thread is never blank */
    await pg.evaluate(() => { try { window.__mlsResetSessionBoundary('ui-harness@mlsscribe.test', { reason: 'session-start' }); } catch (e) {} });
    await pg.waitForTimeout(600);
    await pg.evaluate(() => { try { window.__mlsPatientLock.switchAsDoctor('syn-0'); } catch (e) {} window.__mlsAsst.open(); });
    await pg.waitForTimeout(400);
    await pg.locator('#mlsAsstPanel .as-tab[data-tab=chat]').click(); await pg.waitForTimeout(800);
    const kids = await pg.evaluate(() => { const t = document.querySelector('#mlsAsstPanel .as-thread'); return t ? t.children.length : -1; });
    assert.ok(kids > 0, label + ': the Chat thread is not blank after a session boundary (' + kids + ' items)');
  }

  try {
    const desk = await boot(DESK);
    await schedule(desk, 'desktop', true);
    await chat(desk, 'desktop');

    const phone = await boot(PHONE);
    await schedule(phone, 'phone', false);
    await chat(phone, 'phone');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS assistant schedule and chat truth: appointments open the chart the shell resolves (else "not in MLS yet"), procedure days count their op-note candidates, and the Chat tab keeps showing the conversation it sends');
  } finally { await b.close(); srv.close(); }
});
