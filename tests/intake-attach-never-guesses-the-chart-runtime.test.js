'use strict';
/* A pre-visit intake is never attached to a chart the doctor did not pick
   (stafffix-1.0.0, 2026-09-23). Found by the front-desk / staff hunt on the
   signed-in 1p shell: with two charts named "Jordan Lee" (born 1948 and 1990)
   and an intake from a Jordan Lee born 1990-03-03, the intake card said
   "Same name, but date of birth differs ... (2 matches)" and offered ONE
   button, "Attach to Jordan Lee", hard-wired to whichever chart was first in
   storage. Pressing it put the 1990 patient's Warfarin, Penicillin allergy
   and atrial fibrillation into the 1948 patient's chart. The card showed no
   DOB or MRN for either chart and said "date of birth differs" even when
   one side had no date of birth at all.
   Now: several name matches list every chart with its DOB and MRN, each with
   its own Attach button, plus Create new chart; the single-match button shows
   that chart's DOB; "date of birth differs" is said only when both sides have
   one. Real Chrome; nothing leaves 127.0.0.1 (the MLS server is stubbed). */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  /* the MLS server's pending-intake list; resolve removes an item */
  let pending = [];
  const resolved = [];
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const req = r.request(); const u = new URL(req.url());
      const json = (o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
      if (/scrivara-backend\.onrender\.com$/.test(u.host)) {
        if (u.pathname === '/api/intake/pending' && req.method() === 'GET') return json({ items: pending });
        const mr = u.pathname.match(/^\/api\/intake\/pending\/(\d+)\/resolve$/);
        if (mr && req.method() === 'POST') { resolved.push(Number(mr[1])); pending = pending.filter((x) => String(x.id) !== mr[1]); return json({ ok: true }); }
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
    /* AI is never needed here; stub it so nothing can reach a model */
    await pg.evaluate(() => { window.aiCallRaw = async function () { throw new Error('AI is not used by intake review'); }; });
    return pg;
  };
  /* one card, rendered by the shipped renderer, read back as text + buttons */
  const card = (pg, item) => pg.evaluate((it) => {
    renderPendingIntakes([it]);
    const bx = document.getElementById('pendingIntakeBox');
    return {
      text: bx.innerText.replace(/\s+/g, ' '),
      btns: [...bx.querySelectorAll('button')].map((x) => ({ label: x.textContent.replace(/\s+/g, ' ').trim(), onclick: x.getAttribute('onclick') || '' }))
    };
  }, item);
  const attachesTo = (btn) => { const m = btn.onclick.match(/attachIntake\(\s*\d+\s*,\s*(['"])(.*?)\1\s*\)/); return m ? m[2] : null; };

  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });
    const jl = { id: 77, data: { name: 'Jordan Lee', dob: '1990-03-03', chief: 'Neck pain after fall', pain: 6, meds: 'Warfarin 5mg daily', allergies: 'Penicillin', conditions: 'Atrial fibrillation', submittedAt: Date.now() } };
    pending = [jl];
    const who = await pg.evaluate(async () => {
      sessionStorage.setItem('sf_bk_token', 'harness-token');
      bkUser = { email: 'doc@mlsscribe.test', name: 'Doc Person', role: 'doctor', hasAccess: true, capabilities: {} };
      try { applyAccessUI(); } catch (e) { return 'err ' + e.message; }
      await new Promise((r) => setTimeout(r, 800));
      const pts = getPatients();
      pts.push({ id: 'jl-A', name: 'Jordan Lee', dob: '1948-11-20', mrn: 'MRN-A', notes: [], visits: [], meds: 'Metformin', allergies: 'NKDA' });
      pts.push({ id: 'jl-B', name: 'Jordan Lee', dob: '1990-03-30', mrn: 'MRN-B', notes: [], visits: [], meds: '', allergies: '' });
      pts.push({ id: 'cm-1', name: 'Casey Moss', dob: '1975-06-01', mrn: 'MRN-C', notes: [], visits: [] });
      pts.push({ id: 'rp-1', name: 'Riley Park', dob: '', mrn: '', notes: [], visits: [] });
      pts.push({ id: 'as-1', name: 'Avery Stone', dob: '1960-01-15', mrn: 'MRN-S', notes: [], visits: [] });
      pts.push({ id: 'so-1', name: 'Sam Ortiz', dob: '1982-04-04', mrn: 'MRN-O1', notes: [], visits: [] });
      pts.push({ id: 'so-2', name: 'Sam Ortiz', dob: '1982-04-04', mrn: 'MRN-O2', notes: [], visits: [] });
      savePatients(pts);
      try { showView('patients'); } catch (e) {}
      return 'ok';
    });
    assert.strictEqual(who, 'ok', 'the doctor session boots');
    /* past the 1.5 s read coalescer, so Check intakes asks the server again */
    await pg.waitForTimeout(1800);

    /* 1. two charts share the intake's name, neither has its DOB: every chart
          is listed with DOB and MRN, each with its own Attach, plus Create new
          chart - and no button is bound to "whichever came first" */
    await pg.evaluate(() => loadPendingIntakes(true));
    await pg.waitForFunction(() => /Jordan Lee/.test((document.getElementById('pendingIntakeBox') || {}).innerText || ''), null, { timeout: 10000 });
    const two = await pg.evaluate(() => {
      const bx = document.getElementById('pendingIntakeBox');
      return {
        text: bx.innerText.replace(/\s+/g, ' '),
        btns: [...bx.querySelectorAll('button')].map((x) => ({ label: x.textContent.replace(/\s+/g, ' ').trim(), onclick: x.getAttribute('onclick') || '' }))
      };
    });
    const attach2 = two.btns.filter((x) => attachesTo(x) !== null && attachesTo(x) !== '');
    assert.deepStrictEqual(attach2.map(attachesTo).sort(), ['jl-A', 'jl-B'], 'each same-name chart gets its own Attach button, bound to that chart: ' + JSON.stringify(two.btns));
    const forA = attach2.find((x) => attachesTo(x) === 'jl-A'), forB = attach2.find((x) => attachesTo(x) === 'jl-B');
    assert.ok(/1948-11-20/.test(forA.label) && /MRN-A/.test(forA.label), 'the 1948 chart\'s button shows its DOB and MRN: ' + forA.label);
    assert.ok(/1990-03-30/.test(forB.label) && /MRN-B/.test(forB.label), 'the 1990 chart\'s button shows its DOB and MRN: ' + forB.label);
    assert.ok(two.btns.some((x) => attachesTo(x) === '' && /create new chart/i.test(x.label)), 'Create new chart is offered beside the candidates: ' + JSON.stringify(two.btns));
    assert.ok(/2 charts/.test(two.text), 'the card says how many charts share the name: ' + two.text);

    /* pressing the 1990 chart's button fills THAT chart and leaves the 1948 chart alone */
    await pg.locator('#pendingIntakeBox button', { hasText: 'MRN-B' }).click();
    await pg.waitForFunction(() => getPatients().some((p) => p.id === 'jl-B' && /PRE-VISIT INTAKE/.test(p.summary || '')), null, { timeout: 10000 });
    const after = await pg.evaluate(() => {
      const g = (id) => { const p = getPatients().find((q) => q.id === id) || {}; return { meds: p.meds || '', allergies: p.allergies || '', problems: p.problems || '', intake: /PRE-VISIT INTAKE/.test(p.summary || ''), dob: p.dob }; };
      return { A: g('jl-A'), B: g('jl-B'), toast: ((document.getElementById('toast') || {}).textContent || '') };
    });
    assert.deepStrictEqual(after.A, { meds: 'Metformin', allergies: 'NKDA', problems: '', intake: false, dob: '1948-11-20' }, 'the other Jordan Lee\'s chart is untouched: ' + JSON.stringify(after.A));
    assert.ok(/Warfarin/.test(after.B.meds) && /Penicillin/.test(after.B.allergies) && /Atrial fibrillation/.test(after.B.problems) && after.B.intake, 'the chosen chart gets the intake: ' + JSON.stringify(after.B));
    assert.deepStrictEqual(resolved, [77], 'the intake is marked processed once');

    /* 2. one same-name chart, the intake has no DOB: no "date of birth differs",
          and the button shows the chart's DOB */
    const noIntakeDob = await card(pg, { id: 81, data: { name: 'Casey Moss', chief: 'Knee pain' } });
    assert.ok(!/date of birth differs/i.test(noIntakeDob.text), 'no "date of birth differs" when the intake has no DOB: ' + noIntakeDob.text);
    const cmBtn = noIntakeDob.btns.find((x) => attachesTo(x) === 'cm-1');
    assert.ok(cmBtn && /1975-06-01/.test(cmBtn.label), 'the single-match button shows that chart\'s DOB: ' + JSON.stringify(noIntakeDob.btns));

    /* 3. one same-name chart with no DOB on file: no "date of birth differs",
          and the button says the chart has no DOB */
    const noChartDob = await card(pg, { id: 82, data: { name: 'Riley Park', dob: '1999-09-09', chief: 'Back pain' } });
    assert.ok(!/date of birth differs/i.test(noChartDob.text), 'no "date of birth differs" when the chart has no DOB: ' + noChartDob.text);
    const rpBtn = noChartDob.btns.find((x) => attachesTo(x) === 'rp-1');
    assert.ok(rpBtn && /no DOB/i.test(rpBtn.label), 'the single-match button says that chart has no DOB on file: ' + JSON.stringify(noChartDob.btns));

    /* 4. one same-name chart, both DOBs known and different: the warning is
          right to say so, and the button shows the chart's DOB and MRN */
    const differs = await card(pg, { id: 83, data: { name: 'Avery Stone', dob: '1961-01-15', chief: 'Hip pain' } });
    assert.ok(/date of birth differs/i.test(differs.text), 'a real DOB mismatch is still called out: ' + differs.text);
    const asBtn = differs.btns.find((x) => attachesTo(x) === 'as-1');
    assert.ok(asBtn && /1960-01-15/.test(asBtn.label) && /MRN-S/.test(asBtn.label), 'the single-match button shows the chart\'s DOB and MRN: ' + JSON.stringify(differs.btns));
    assert.ok(differs.btns.some((x) => attachesTo(x) === ''), 'a new chart is still offered');

    /* 5. two charts share name AND DOB: each is listed with its MRN, plus Create new chart */
    const same = await card(pg, { id: 84, data: { name: 'Sam Ortiz', dob: '1982-04-04', chief: 'Shoulder pain' } });
    const so = same.btns.filter((x) => attachesTo(x) && attachesTo(x) !== '');
    assert.deepStrictEqual(so.map(attachesTo).sort(), ['so-1', 'so-2'], 'each chart sharing name and DOB gets its own Attach: ' + JSON.stringify(same.btns));
    assert.ok(/MRN-O1/.test(so.find((x) => attachesTo(x) === 'so-1').label) && /MRN-O2/.test(so.find((x) => attachesTo(x) === 'so-2').label), 'each shows its MRN');
    assert.ok(same.btns.some((x) => attachesTo(x) === '' && /create new chart/i.test(x.label)), 'Create new chart is offered');

    /* 6. an exact single match still attaches in one press */
    const exact = await card(pg, { id: 85, data: { name: 'Avery Stone', dob: '1960-01-15', chief: 'Hip pain' } });
    assert.ok(exact.btns.some((x) => attachesTo(x) === 'as-1') && /Matches existing chart/.test(exact.text), 'an exact name + DOB match keeps its one-press attach: ' + JSON.stringify(exact));

    /* the intake form sends yyyy-mm-dd; an Athena chart holds mm/dd/yyyy - that
       is the same date, not "date of birth differs"; an Athena ID stands in for
       a missing MRN on the button */
    const fmt = await pg.evaluate(() => {
      const pts = getPatients();
      const p = pts[pts.length - 1];
      const keep = { name: p.name, dob: p.dob, mrn: p.mrn, athenaId: p.athenaId };
      Object.assign(p, { name: 'Pat Format', dob: '07/04/1985', mrn: '', athenaId: '44123' });
      const m = findPatientMatch('Pat Format', '1985-07-04');
      const btn = _intakeAttachBtn(1, p, 'btn-ghost');
      Object.assign(p, keep);
      return { confident: !!(m && m.confident), btn };
    });
    assert.strictEqual(fmt.confident, true, 'mm/dd/yyyy on the chart and yyyy-mm-dd on the intake are one date of birth');
    assert.match(fmt.btn, /MRN 44123/, 'the Athena ID labels a chart with no MRN');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS intake attach never guesses the chart: several same-name charts are each listed with DOB and MRN and their own Attach, the chosen chart alone gets the intake, the single-match button shows the chart\'s DOB, and "date of birth differs" is said only when both sides have one');
  } finally { await b.close(); srv.close(); }
});
