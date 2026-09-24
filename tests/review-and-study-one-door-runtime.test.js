'use strict';
/* Review, AI Studio and Study / Import: one door per action, honest copy
   (uifix-1.0.0, 2026-09-24). Found by the real-Chrome UI audit of every screen
   outside Visit and Settings:
   - C14 Recommendations could be reached from the Review row only while already
     on it: nav-reorg hid #nav_recs with inline display:none, which the calm
     shell reads as "not offered", and a stand-in segment was painted on
     Recommendations alone;
   - C15 (History in the Review row as well as the Patient row) is NOT
     applied: the owner's 2026-07-28 order "put history into the review tab"
     stands, so the Review row reads Orders | Recommendations | The note |
     History and Patient keeps its own History door;
   - C47 "Pull from current note" and "Suggest orders" ignored a typed or pasted
     note ("generate a note in Visit first") while Review counted its words;
     the note's Assessment is read the way doctors write it (ASSESSMENT:, A:,
     A/P:, Assessment/Plan:, and a one-line "Assessment: ... Plan: ..."), and
     a note whose Assessment cannot be read is never said to have none;
   - C48 Orders carried a third "Back to visit" door;
   - C50 Recommendations showed Generate and Regenerate together, plus Orders
     and Visit buttons that repeat the segments and the dock;
   - C51 the AI Studio section hint was a <span> inside the tab bar that read as
     a fourth tab;
   - C53 Study / Import > By procedure showed a permanently disabled FHIR
     button, developer notes ("needs live tuning", "autopilot v1.31", "frozen
     extension", window.__mlsStudyConfig), one practice's facility and Athena
     department id, and an empty Cohorts tab.
   Real Chrome, trusted clicks; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const NOTE = 'HPI: 54-year-old with low back pain radiating to the right leg for 6 weeks.\n' +
  'EXAM: Straight-leg raise positive on the right at 45 degrees.\n' +
  'ASSESSMENT: Right L5 radiculopathy (M54.16).\n' +
  'PLAN: Right L4-L5 transforaminal epidural steroid injection. Follow up in 2 weeks.';
/* Facility names MLS has on file are said on purpose (the search runs only
   for them); their alias and Athena department id are not. */
const DEV_NOTES = /needs live tuning|autopilot|v1\.31|frozen extension|see notes|works now|__mlsStudyConfig|disabled until API access|FHIR|HTTP \d|SCCC|department 744|\(268\)/i;
const REVIEW_ROW = ['Orders', 'Recommendations', 'The note', 'History'];

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const boot = async (ctxOpts, fhirLive, fullApp) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    /* the phone's "Show the full app" choice, so the Review row is on screen */
    if (fullApp) await pg.addInitScript(() => { try { sessionStorage.setItem('mls_phone_mode', '0'); localStorage.setItem('mls_layout_pref', 'full'); } catch (e) {} });
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    if (fhirLive) await pg.route(/\/api\/study\/cohort-by-cpt\/capability/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"available":true}' }));
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
    await pg.evaluate(async () => { window.__mlsPatientLock.switchAsDoctor('syn-0'); await new Promise((r) => setTimeout(r, 500)); });
    return pg;
  };
  const view = (pg, v) => pg.evaluate(async (v) => { showView(v); await new Promise((r) => setTimeout(r, 900)); }, v);
  const segs = (pg) => pg.evaluate(() => [...document.querySelectorAll('#mlsRightNow .seg .segbtn')]
    .filter((x) => x.getClientRects().length).map((x) => x.textContent.trim() + (x.classList.contains('on') ? '*' : '')));
  /* a trusted click on the first visible element matching sel + text */
  const press = async (pg, sel, re) => {
    const i = await pg.evaluate(({ sel, src }) => {
      const re = new RegExp(src, 'i');
      const all = [...document.querySelectorAll(sel)];
      const hit = all.findIndex((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden' && re.test(x.textContent || ''));
      return hit;
    }, { sel, src: re.source });
    assert.ok(i >= 0, 'nothing to press for ' + sel + ' ' + re);
    await pg.locator(sel).nth(i).click();
    await pg.waitForTimeout(900);
  };
  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });

    /* C14: Review offers Recommendations from Orders as a real segment. History
       stays on the Review row (owner order, C15 not applied). */
    await view(pg, 'orders');
    const onOrders = await segs(pg);
    assert.deepStrictEqual(onOrders, ['Orders*', 'Recommendations', 'The note', 'History'], 'the Review row on Orders offers Recommendations, and keeps the owner\'s History segment: ' + JSON.stringify(onOrders));
    await press(pg, '#mlsRightNow .seg .segbtn', /^Recommendations$/);
    const landed = await pg.evaluate(() => ({ recs: getComputedStyle(document.getElementById('recsView')).display !== 'none', dock: (document.querySelector('#mlsDock button[aria-current="page"], #mlsDock button.on') || {}).textContent || '' }));
    assert.ok(landed.recs, 'pressing Recommendations on the Review row opens Recommendations');
    const onRecs = await segs(pg);
    assert.deepStrictEqual(onRecs, ['Orders', 'Recommendations*', 'The note', 'History'], 'one lit Recommendations segment on Recommendations: ' + JSON.stringify(onRecs));
    assert.strictEqual(await pg.evaluate(() => document.querySelectorAll('#mlsRightNow [data-mls-clunky-seg]').length), 0, 'Recommendations is the calm shell\'s own segment, not a painted stand-in');
    assert.strictEqual(await pg.evaluate(() => document.getElementById('nav_recs').getClientRects().length), 0, 'the relocated rail tab itself stays out of sight');
    await press(pg, '#mlsRightNow .seg .segbtn', /^Orders$/);
    assert.ok(await pg.evaluate(() => getComputedStyle(document.getElementById('ordersView')).display !== 'none'), 'and Orders is one press back from Recommendations');
    await view(pg, 'patients');
    assert.ok((await segs(pg)).includes('History'), 'History keeps its door on the Patient row');

    /* C48: no third "Back to visit" on Orders */
    await view(pg, 'orders');
    const back = await pg.evaluate(() => [...document.querySelectorAll('#ordersView button')].filter((x) => x.getClientRects().length && /back to visit/i.test(x.textContent)).length);
    assert.strictEqual(back, 0, 'Orders has no "Back to visit" button of its own');

    /* C47: a typed note is the current note for Pull and for Suggest */
    await pg.evaluate((note) => {
      lastEMR = null; currentCoding = null; ordersDx = { text: '', icd: [] }; renderOrdersDx();
      const n = document.getElementById('noteBox'); n.value = note; n.dispatchEvent(new Event('input', { bubbles: true }));
    }, NOTE);
    await press(pg, '#ordersView button', /Pull from current note/);
    const pulled = await pg.evaluate(() => ({ body: document.getElementById('ordersDxBody').innerText, chips: ordersDx.icd.slice(), suggest: getComputedStyle(document.getElementById('ordersSuggestWrap')).display !== 'none' && document.getElementById('ordersSuggestChips').querySelectorAll('.dotchip').length }));
    assert.ok(/Right L5 radiculopathy/.test(pulled.body) && !/Follow up|transforaminal/i.test(pulled.body), 'the pull reads the typed Assessment, and only it: ' + pulled.body);
    assert.deepStrictEqual(pulled.chips, ['M54.16'], 'the ICD-10 code written in the note is pulled');
    assert.ok(/M54\.16/.test(pulled.body), 'and shown with the diagnosis');
    assert.ok(pulled.suggest > 0, 'the pulled diagnosis feeds order suggestions');
    await pg.evaluate(() => { ordersDx = { text: '', icd: [] }; renderOrdersDx(); document.getElementById('ordersSuggestWrap').style.display = 'none'; });
    await press(pg, '#ordersView button', /Suggest orders/);
    const suggested = await pg.evaluate(() => document.getElementById('ordersSuggestChips').querySelectorAll('.dotchip').length);
    assert.ok(suggested > 0, '"Suggest orders" reads the typed note without a separate pull first');
    const noNote = await pg.evaluate(async () => {
      const n = document.getElementById('noteBox'); n.value = ''; currentSoap = ''; ordersDx = { text: '', icd: [] };
      pullDxFromNote(); await new Promise((r) => setTimeout(r, 150));
      return (document.getElementById('toast') || {}).textContent || '';
    });
    assert.ok(/no note yet/i.test(noNote) && !/generate a note in Visit first/i.test(noNote), 'with no note the pull says so plainly: ' + noNote);

    /* C47: the Assessment as doctors write it, and nothing past it */
    const shapes = await pg.evaluate(() => {
      const read = (note) => { const n = document.getElementById('noteBox'); n.value = note; lastEMR = null; currentCoding = null; const d = noteDiagnosisText(); return { text: d.text, icd: d.icd.slice(), section: d.section }; };
      return {
        oneLine: read('Assessment: Lumbar radiculopathy M54.16. Plan: TFESI, gabapentin, f/u 2 weeks.'),
        soap: read('S: Low back pain for 6 weeks.\nO: Straight-leg raise positive.\nA: Lumbar radiculopathy\nP: TFESI.'),
        ap: read('HPI: Back pain.\nA/P: Lumbar spondylosis M47.816, medial branch blocks next.'),
        apWords: read('Assessment/Plan: Sacroiliac joint dysfunction M53.3, SI joint injection.'),
        vitamin: read('HPI: Takes vitamin A: 5000 IU daily.\nAssessment: Low back pain M54.50'),
        empty: read('HPI: Back pain.\nAssessment:\nPlan: Physical therapy.'),
        none: read('HPI: Back pain for 6 weeks. Exam: tender lumbar paraspinals.')
      };
    });
    assert.ok(/^Lumbar radiculopathy M54\.16\.?$/.test(shapes.oneLine.text) && shapes.oneLine.icd.join() === 'M54.16', 'a one-line "Assessment: ... Plan: ..." stops at the Plan: ' + JSON.stringify(shapes.oneLine));
    assert.strictEqual(shapes.soap.text, 'Lumbar radiculopathy', 'the SOAP "A:" line is the Assessment: ' + JSON.stringify(shapes.soap));
    assert.ok(/Lumbar spondylosis/.test(shapes.ap.text) && shapes.ap.icd.join() === 'M47.816', '"A/P:" is read: ' + JSON.stringify(shapes.ap));
    assert.ok(/Sacroiliac joint dysfunction/.test(shapes.apWords.text) && shapes.apWords.icd.join() === 'M53.3', '"Assessment/Plan:" is read: ' + JSON.stringify(shapes.apWords));
    assert.ok(shapes.vitamin.text === 'Low back pain M54.50', '"vitamin A:" inside a sentence is not a heading: ' + JSON.stringify(shapes.vitamin));
    assert.deepStrictEqual([shapes.empty.section, shapes.none.section], ['empty', 'none'], 'an empty Assessment and a note without one are told apart: ' + JSON.stringify([shapes.empty, shapes.none]));
    const says = await pg.evaluate(async () => {
      const out = {};
      for (const [k, note] of [['soap', 'S: pain.\nA: Lumbar radiculopathy\nP: ESI'], ['empty', 'HPI: Back pain.\nAssessment:\nPlan: Physical therapy.'], ['none', 'HPI: Back pain for 6 weeks.']]) {
        const n = document.getElementById('noteBox'); n.value = note; lastEMR = null; currentCoding = null; ordersDx = { text: '', icd: [] };
        const t = document.getElementById('toast'); if (t) t.textContent = '';
        pullDxFromNote(); await new Promise((r) => setTimeout(r, 150));
        out[k] = { toast: (document.getElementById('toast') || {}).textContent || '', dx: ordersDx.text };
      }
      ordersDx = { text: '', icd: [] }; renderOrdersDx(); document.getElementById('noteBox').value = '';
      return out;
    });
    assert.strictEqual(says.soap.dx, 'Lumbar radiculopathy', 'a note with an "A:" Assessment pulls it: ' + JSON.stringify(says.soap));
    assert.ok(!/has no Assessment|no Assessment or/i.test(says.soap.toast + says.empty.toast + says.none.toast), 'no press claims the note has no Assessment: ' + JSON.stringify(says));
    assert.ok(/Assessment in the current note is empty/.test(says.empty.toast), 'an empty Assessment is named as empty: ' + says.empty.toast);
    assert.ok(/could not find an Assessment/.test(says.none.toast), 'a note without a readable Assessment says MLS could not find one: ' + says.none.toast);

    /* C50: one Generate door on Recommendations, no Orders / Visit copies */
    const recs = await pg.evaluate(async () => {
      showView('recs'); await new Promise((r) => setTimeout(r, 600));
      const doors = () => [...document.querySelectorAll('#recsView button')].filter((x) => x.getClientRects().length).map((x) => x.textContent.trim());
      const before = doors();
      currentRecs = { care_gaps: ['Colon cancer screening due'], interactions: [], follow_up: [], documentation: [] };
      renderRecommendations();
      const after = doors();
      currentRecs = null; renderRecommendations();
      return { before, after, reset: document.getElementById('genRecsBtn').textContent.trim() };
    });
    const gen = (list) => list.filter((t) => /generate/i.test(t));
    assert.deepStrictEqual(gen(recs.before), ['✨ Generate Recommendations'], 'one Generate button before there are suggestions: ' + JSON.stringify(recs.before));
    assert.deepStrictEqual(gen(recs.after), ['🔄 Regenerate recommendations'], 'one button, named Regenerate, once suggestions show: ' + JSON.stringify(recs.after));
    assert.ok(!recs.before.concat(recs.after).some((t) => /^(📋 )?Orders$|^(🎙️ )?Visit$/.test(t)), 'no Orders / Visit buttons repeat the Review row and the dock: ' + JSON.stringify(recs.after));
    assert.strictEqual(recs.reset, '✨ Generate Recommendations', 'a new visit with no suggestions is back to Generate');

    /* C51: the AI Studio tab bar holds tabs only */
    const studio = await pg.evaluate(async () => {
      showView('studio');
      for (let i = 0; i < 40 && !document.getElementById('mlsSmTabs'); i++) await new Promise((r) => setTimeout(r, 250));
      const bar = document.getElementById('mlsSmTabs'); if (!bar) return null;
      const kids = [...bar.children].filter((x) => x.getClientRects().length);
      return { kids: kids.map((x) => x.getAttribute('role') + ':' + x.textContent.trim()), titles: kids.map((x) => x.title || x.getAttribute('data-tip') || ''), text: bar.innerText };
    });
    assert.ok(studio, 'AI Studio mounts its section tabs');
    assert.deepStrictEqual(studio.kids, ['tab:Ask', 'tab:Practice', 'tab:Study & build'], 'the tab bar holds the three tabs and nothing that looks like a fourth: ' + JSON.stringify(studio.kids));
    assert.ok(!/Ask the Copilot about your practice/.test(studio.text) && /Ask the Copilot about your practice/.test(studio.titles[0]), 'the section hint moved from the bar into the tab tooltip');

    /* C53 + Study / Import: doctor words, no dead FHIR button, no empty Cohorts tab */
    const opened = await pg.evaluate(() => {
      window.__mlsSessionAccount = 'ui-harness@mlsscribe.test'; window.__mlsSessionEpoch = 7;
      try { localStorage.setItem('sf_bk_token', 'tok-review-study'); } catch (e) {}
      return window.__mlsStudy.open('A');
    });
    assert.strictEqual(opened, true, 'Study / Import opens');
    await pg.waitForTimeout(600);
    const tabsA = await pg.evaluate(() => [...document.querySelectorAll('#mlsStudyOv .mls-study-tabs [data-t]')].map((x) => x.textContent.trim()));
    assert.deepStrictEqual(tabsA, ['By name + DOB', 'By procedure'], 'no Cohorts tab while there is no cohort: ' + JSON.stringify(tabsA));
    await press(pg, '#mlsStudyOv .mls-study-tabs button', /By procedure/);
    await pg.waitForTimeout(2200);
    const modeB = await pg.evaluate(() => {
      const c = document.querySelector('#mlsStudyOv .mls-study-card');
      const vis = [...c.querySelectorAll('button')].filter((x) => x.getClientRects().length);
      return { text: c.innerText, ph: [...c.querySelectorAll('input,textarea')].map((x) => x.placeholder).join(' | '),
        disabled: vis.filter((x) => x.disabled).map((x) => x.textContent.trim()), fhir: !!document.getElementById('mlsStudyFhirBtn'),
        occ: !!document.getElementById('mlsOccPanel'), grab: !!document.getElementById('mlsGrabAthenaBtn'),
        autoRun: !!document.getElementById('mlsGrabDrive'), noProc: /No procedure yet/.test(c.innerText),
        search: vis.filter((x) => /Search Athena with MLS Assist/.test(x.textContent)).length };
    });
    assert.ok(modeB.occ && modeB.grab, 'the By procedure tab still carries its searches: ' + JSON.stringify({ occ: modeB.occ, grab: modeB.grab }));
    assert.ok(!DEV_NOTES.test(modeB.text), 'By procedure reads as doctor instructions: ' + (modeB.text.match(DEV_NOTES) || [])[0]);
    assert.ok(!/SCCC|Chester|744|our surgery center|as Athena shows it/i.test(modeB.ph), 'no facility alias, and no promise that any facility works, in the placeholders: ' + modeB.ph);
    assert.ok(/Facilities MLS has on file: POSM ASC Chester County and POSM ASC Chester County Hospital\./.test(modeB.text), 'the panel says which facilities MLS has on file: ' + (modeB.text.match(/Facilities[^.]*\./) || [])[0]);
    assert.ok(/On some Athena screens it cannot read the results/.test(modeB.text), 'the plain-language caveat on MLS Assist reading stays');
    assert.deepStrictEqual(modeB.disabled, [], 'no permanently disabled button: ' + JSON.stringify(modeB.disabled));
    assert.strictEqual(modeB.fhir, false, 'the Athena API query is not offered while the API is not connected');
    assert.strictEqual(modeB.autoRun, false, 'no "Auto-run" box that nothing reads');
    assert.strictEqual(modeB.search, 1, 'one "Search Athena with MLS Assist" button, not a static twin beside it');
    assert.strictEqual(modeB.noProc, false, '"No procedure yet" is not offered as a procedure to tag');
    const typed = await pg.evaluate(async () => {
      const f = document.getElementById('mlsOccFacility'); f.value = 'Main Street Clinic'; f.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));
      return document.getElementById('mlsOccResolved').textContent;
    });
    assert.ok(/does not have a facility called “Main Street Clinic”/.test(typed) && !/Will match/.test(typed) && /on file: POSM ASC/.test(typed), 'an unknown facility is not promised a match, and the ones on file are named: ' + typed);
    const cohort = await pg.evaluate(async () => {
      const p = getPatients()[0];
      window.__mlsStudy._tagPatientCohort(p, 'Lumbar ESI 2026');
      await new Promise((r) => setTimeout(r, 200));
      return [...document.querySelectorAll('#mlsStudyOv .mls-study-tabs [data-t]')].map((x) => x.textContent.trim());
    });
    assert.deepStrictEqual(cohort, ['By name + DOB', 'By procedure', 'Cohorts'], 'the Cohorts tab appears the moment a cohort exists: ' + JSON.stringify(cohort));
    await press(pg, '#mlsStudyOv .mls-study-tabs button', /^Cohorts$/);
    assert.ok(await pg.evaluate(() => /Lumbar ESI 2026/.test(document.getElementById('mlsStudyBody').innerText)), 'the Cohorts tab lists the cohort');
    await pg.evaluate(() => window.__mlsStudy.close());

    /* C53 positive: once the Athena API answers, the query is offered and pressable */
    const live = await boot({ viewport: { width: 1400, height: 900 } }, true);
    const liveB = await live.evaluate(async () => {
      window.__mlsSessionAccount = 'ui-harness@mlsscribe.test'; window.__mlsSessionEpoch = 7;
      try { localStorage.setItem('sf_bk_token', 'tok-review-study'); } catch (e) {}
      window.__mlsStudy.open('B');
      for (let i = 0; i < 30; i++) { const s = document.getElementById('mlsStudyFhirSec'); if (s && !s.hidden) break; await new Promise((r) => setTimeout(r, 200)); }
      const btn = document.getElementById('mlsStudyFhirBtn');
      return { shown: !!(btn && btn.getClientRects().length), disabled: btn ? btn.disabled : null, text: btn ? btn.textContent : '' };
    });
    assert.deepStrictEqual({ shown: liveB.shown, disabled: liveB.disabled }, { shown: true, disabled: false }, 'with the API connected the query is offered: ' + JSON.stringify(liveB));
    assert.ok(!DEV_NOTES.test(liveB.text), 'its label is doctor words: ' + liveB.text);
    /* pressing it: doctor words while it asks and when Athena sends nothing back */
    const liveRun = await live.evaluate(async () => {
      const out = document.getElementById('mlsStudyFhirOut');
      document.getElementById('mlsStudyBProc').value = '';
      document.getElementById('mlsStudyBSel').value = '';
      document.getElementById('mlsStudyFhirBtn').click();
      const noCode = out.innerText;
      document.getElementById('mlsStudyBProc').value = '62330';
      document.getElementById('mlsStudyFhirBtn').click();
      const asking = out.innerText;
      for (let i = 0; i < 30 && /Asking Athena/.test(out.innerText); i++) await new Promise((r) => setTimeout(r, 200));
      return { noCode, asking, failed: out.innerText };
    });
    for (const [k, t] of Object.entries(liveRun)) assert.ok(t && !DEV_NOTES.test(t) && !/may not be approved|API/.test(t), 'pressing "Ask Athena" says doctor words (' + k + '): ' + t);
    assert.ok(/nothing was imported/.test(liveRun.failed), 'a failed answer says nothing was imported: ' + liveRun.failed);

    /* phone: the Review row fits the screen */
    const ph = await boot({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }, false, true);
    await view(ph, 'orders');
    const fit = await ph.evaluate(() => [...document.querySelectorAll('#mlsRightNow .seg .segbtn')].map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), w: Math.round(r.width), right: Math.round(r.right) }; }));
    assert.deepStrictEqual(fit.map((x) => x.t), REVIEW_ROW, 'the phone Review row offers the same four: ' + JSON.stringify(fit));
    assert.ok(fit.every((x) => x.w > 0 && x.right <= 390), 'every Review segment is on the phone screen: ' + JSON.stringify(fit));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS review and study one door: Recommendations is a real Review segment beside the owner\'s History, the Assessment of a typed note feeds Orders, one Generate button, a tab bar of tabs, and Study / Import speaks doctor with no dead Athena button, the facilities on file named and no empty Cohorts tab');
  } finally { await b.close(); srv.close(); }
});
