'use strict';
/* Patients and Settings tell the truth (ptfix-1.0.0, b1321).
   Found by the Patients / Settings hunt on the signed-in 1p shell:
   - a new patient with the same name and date of birth but a DIFFERENT MRN
     was folded into the other person's chart, the typed MRN dropped, and the
     toast said "Patient saved";
   - a search typed as MM/DD/YYYY (the format the app prints) found nothing and
     offered to add a patient NAMED after the date;
   - impossible dates of birth (2099-13-45, 02/30/2027) were saved;
   - Settings > Text size changed 1 of 139 texts on Patients;
   - the taskbar nub sat over New patient / Settings and opened its menu there;
   - Patient profile position and Group by procedure were marked "Applies
     right away" while Cancel undid them; the portal-invite switch wrote at
     once with no mark;
   - the Orders "App tabs" switch changed nothing;
   - Settings pointed at an "Advanced tab" and a "header button" that do not
     exist, and hid the link that ends "Not installed? Get the extension.";
   - the phone Record button on every patient row read "Recor" beside two mics;
   - in the sample, Account & security opened the Settings the sample refuses,
     with its Save / Cancel under the sample strip.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
assert.ok(!/The Advanced tab shows whether/.test(SHELL), 'Settings no longer points at an Advanced tab that does not exist');
assert.ok(!/the header button you hand to the patient/.test(SHELL), 'Settings no longer points at a header intake button that does not exist');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
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
  const base = 'http://127.0.0.1:' + srv.address().port;
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto(base + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
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
    await pg.evaluate(() => { window.__said = []; const t0 = window.toast; window.toast = function (m, k) { window.__said.push(String(m)); return t0.apply(this, arguments); }; });
    await pg.evaluate(() => window.__clunky.nav('nav_patients'));
    await pg.waitForTimeout(800);
    return pg;
  };
  const addPatient = async (pg, f) => {
    await pg.evaluate(() => { window.__said = []; });
    await pg.click('#ptNewBtn');
    await pg.waitForSelector('#patientModal.show');
    await pg.fill('#ptName', f.name); await pg.fill('#ptMrn', f.mrn || ''); await pg.fill('#ptDob', f.dob || '');
    if (f.sex) await pg.selectOption('#ptSex', f.sex);
    await pg.click('#patientModal .btn-primary');
    await pg.waitForTimeout(900);
    return pg.evaluate(() => ({ open: document.getElementById('patientModal').classList.contains('show'), said: window.__said.slice() }));
  };
  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });

    /* 1. a different MRN is a different person */
    const before = await pg.evaluate(() => { const a = getPatients().find((p) => p.name === 'Ada Sample'); return { n: getPatients().length, dob: a.dob, mrn: a.mrn, sex: a.sex || '' }; });
    const other = await addPatient(pg, { name: 'Ada Sample', mrn: 'NEWMRN-2000777', dob: before.dob, sex: 'Male' });
    const after = await pg.evaluate(() => ({ n: getPatients().length, mine: getPatients().filter((p) => p.mrn === 'NEWMRN-2000777').length, first: (getPatients().find((p) => p.name === 'Ada Sample' && p.mrn !== 'NEWMRN-2000777') || {}) }));
    assert.strictEqual(after.n, before.n + 1, 'a same-name, same-DOB patient with another MRN gets a chart of their own: ' + JSON.stringify({ before, after: after.n, said: other.said }));
    assert.strictEqual(after.mine, 1, 'the typed MRN is kept');
    assert.strictEqual(after.first.sex || '', before.sex, 'the other person\'s chart is not changed');
    /* the same person again (no MRN typed) opens the chart on file and says so */
    const ann = await pg.evaluate(() => { const a = getPatients().find((p) => p.name === 'Ann Sample'); return { n: getPatients().length, dob: a.dob }; });
    const again = await addPatient(pg, { name: 'Ann Sample', dob: ann.dob });
    assert.strictEqual(await pg.evaluate(() => getPatients().length), ann.n, 'the same name and DOB with no MRN still opens the chart on file');
    assert.ok(again.said.some((m) => /already on file/.test(m)) && !again.said.some((m) => /Patient saved/.test(m)), 'and says an existing chart was opened: ' + JSON.stringify(again.said));

    /* 2. impossible dates of birth are refused, free text is not */
    for (const dob of ['2099-13-45', '02/30/2027', '01/01/2999', '2/3/61', 'Feb 30 1990', '1990-02-10T00:00']) {
      const r = await addPatient(pg, { name: 'Zed Datecheck', dob });
      assert.ok(r.open && r.said.some((m) => /not a real date of birth/.test(m)), 'DOB ' + dob + ' is refused with a reason: ' + JSON.stringify(r));
      await pg.evaluate(() => closePatientModal());
    }
    assert.strictEqual(await pg.evaluate(() => getPatients().filter((p) => p.name === 'Zed Datecheck').length), 0, 'no chart was made with an impossible DOB');
    const free = await addPatient(pg, { name: 'Zed Agecheck', dob: 'age 44' });
    assert.ok(!free.open, '"age 44" is still accepted: ' + JSON.stringify(free));

    /* 3. a DOB typed the way the app prints it finds the chart */
    const target = await pg.evaluate(() => { const p = getPatients().find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.dob || '') && x.name === 'Ada Sample'); const [y, m, d] = p.dob.split('-'); return { name: p.name, us: m + '/' + d + '/' + y, short: (+m) + '/' + (+d) + '/' + y }; });
    for (const q of [target.us, target.short]) {
      await pg.fill('#ptSearch', q); await pg.waitForTimeout(700);
      const found = await pg.evaluate((n) => [...document.querySelectorAll('#ptList .pt-item')].filter((r) => r.getClientRects().length && r.textContent.indexOf(n) >= 0).length, target.name);
      assert.ok(found >= 1, 'searching "' + q + '" finds ' + target.name);
    }
    await pg.fill('#ptSearch', '07/04/1901'); await pg.waitForTimeout(700);
    const offer = await pg.evaluate(() => { const b = document.querySelector('#ptNoMatch button, [onclick="newPatientFromSearch()"]'); return b ? b.textContent : ''; });
    assert.match(offer, /born 07\/04\/1901/, 'a date with no match offers a patient born then, not one named after it: ' + offer);
    await pg.evaluate(() => newPatientFromSearch()); await pg.waitForTimeout(300);
    assert.deepStrictEqual(await pg.evaluate(() => [document.getElementById('ptName').value, document.getElementById('ptDob').value]), ['', '07/04/1901'], 'the date goes in Date of birth');
    await pg.evaluate(() => closePatientModal());
    await pg.fill('#ptSearch', ''); await pg.waitForTimeout(400);

    /* 4. Text size scales the workspace */
    const grew = await pg.evaluate(async () => {
      const row = document.querySelector('#ptList .pt-item'); const h0 = row.getBoundingClientRect().height;
      const w = document.getElementById('appWrap'); const l0 = Math.round(w.getBoundingClientRect().left);
      document.body.classList.add('text-large'); await new Promise((r) => setTimeout(r, 100));
      const h1 = row.getBoundingClientRect().height; const l1 = Math.round(w.getBoundingClientRect().left);
      document.body.classList.remove('text-large');
      return { h0, h1, l0, l1, over: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(grew.h1 > grew.h0 * 1.08, 'Large text makes a patient row bigger: ' + JSON.stringify(grew));
    assert.ok(Math.abs(grew.l1 - grew.l0) <= 2 && grew.over <= 0, 'and the workspace keeps its side gutter, with no sideways scroll: ' + JSON.stringify(grew));

    /* 5. Settings: the nub is under the dialog; the marks and Cancel agree */
    await pg.evaluate(() => openSettings({ userInitiated: true })); await pg.waitForTimeout(1200);
    const nub = await pg.evaluate(() => {
      const n = document.getElementById('mlsDockNub'); if (!n || !n.getClientRects().length) return null;
      const r = n.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { onTop: !!(e && (e === n || n.contains(e))) };
    });
    if (nub) assert.strictEqual(nub.onTop, false, 'the taskbar nub is not above the Settings dialog');
    const marks = await pg.evaluate(() => {
      const chip = (id) => { const c = document.getElementById(id); const f = c && c.closest('.field'); return f ? !!f.querySelector('.mlsT2Now') : null; };
      const sec = document.getElementById('navFeatToggles'); const s = sec && sec.closest('.set-section');
      const orders = document.getElementById('nav_orders');
      return { layout: chip('qolPtLayout'), group: chip('qolGroupProc'), portal: chip('mlsPortalAskTgl'),
        appTabs: !!(s && s.getClientRects().length), oldOrdersTab: !!(orders && orders.getClientRects().length) };
    });
    assert.strictEqual(marks.layout, false, 'Patient profile position is not marked "Applies right away"');
    assert.strictEqual(marks.group, false, 'Group by procedure is not marked "Applies right away"');
    if (marks.portal !== null) assert.strictEqual(marks.portal, true, 'the portal-invite switch, which writes at once, is marked');
    assert.deepStrictEqual([marks.appTabs, marks.oldOrdersTab], [false, false], 'no App tabs switch that changes nothing, and the tab it gated is not on screen');
    const cancel = await pg.evaluate(async () => {
      const key = uns('qolPtLayout'), stored = localStorage.getItem(key), was = document.body.classList.contains('pt-split');
      const sel = document.getElementById('qolPtLayout'); sel.value = was ? 'stack' : 'split'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const during = { stored: localStorage.getItem(key), split: document.body.classList.contains('pt-split') };
      closeSettings(); await new Promise((r) => setTimeout(r, 300));
      return { was, stored, during, after: document.body.classList.contains('pt-split'), storedAfter: localStorage.getItem(key) };
    });
    assert.strictEqual(cancel.during.split, !cancel.was, 'the layout previews while Settings is open');
    assert.strictEqual(cancel.during.stored, cancel.stored, 'nothing is stored before Save');
    assert.deepStrictEqual([cancel.after, cancel.storedAfter], [cancel.was, cancel.stored], 'Cancel puts the layout back');

    /* 5b. a local chart newer than the account's copy is queued to go back up
       (updfix-1.0.0: the server used to acknowledge and drop edits of charts
       it already held; the newer local copies must reach it now) */
    const heal = await pg.evaluate(async () => {
      const ps = getPatients().slice(0, 3);
      const rows = [
        { id: 901, external_id: ps[0].id, data: Object.assign({}, ps[0], { updated: (ps[0].updated || Date.now()) - 60000 }) },
        { id: 902, external_id: ps[1].id, data: Object.assign({}, ps[1], { updated: ps[1].updated || 0 }) },
        { id: 903, external_id: ps[2].id, data: Object.assign({}, ps[2], { updated: (ps[2].updated || 0) + 60000, problems: 'Server copy is newer' }) }
      ];
      const keep = { bm: window.backendMode, tk: window.bkToken, fl: window.sfFetchPagedList };
      window.backendMode = () => true; window.bkToken = () => 'test-token';
      window.sfFetchPagedList = async () => ({ ok: true, status: 200, rows });
      let ran = null;
      try { ran = await loadPatientsFromServer({}); } finally { window.backendMode = keep.bm; window.bkToken = keep.tk; window.sfFetchPagedList = keep.fl; }
      const pending = _pendingSyncGet();
      const adopted = (getPatients().find((p) => p.id === ps[2].id) || {}).problems;
      return { ran, older: pending.includes(String(ps[0].id)), same: pending.includes(String(ps[1].id)), newer: pending.includes(String(ps[2].id)), adopted };
    });
    assert.deepStrictEqual({ older: heal.older, same: heal.same, newer: heal.newer, adopted: heal.adopted },
      { older: true, same: false, newer: false, adopted: 'Server copy is newer' },
      'only a local copy newer than the account\'s is queued; an equal one is left alone and a newer server copy is adopted: ' + JSON.stringify(heal));

    /* 6. phone: the Record button on a patient row is one clean mic */
    const ph = await boot(PHONE);
    const rec = await ph.evaluate(() => {
      const bs = [...document.querySelectorAll('#ptList .pt-item > div:last-child > button:not(.del)')].filter((x) => x.getClientRects().length);
      return bs.slice(0, 5).map((x) => ({ w: x.clientWidth, sw: x.scrollWidth, fs: getComputedStyle(x).fontSize, name: x.getAttribute('aria-label') || '' }));
    });
    assert.ok(rec.length > 0, 'the phone rows have their Record button');
    rec.forEach((r) => {
      assert.strictEqual(r.fs, '0px', 'the Record label does not spill out: ' + JSON.stringify(r));
      assert.match(r.name, /Record/, 'and the button keeps its name for a screen reader');
    });

    /* 7. the sample: Account & security is off like Tools > Settings */
    const sp = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    sp.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await sp.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await sp.goto(base + '/ScribeFlow.html?preview=1', { waitUntil: 'load', timeout: 90000 });
    await sp.waitForTimeout(9000);
    const btn = await sp.$('#mlsAccountMenuBtn');
    assert.ok(btn, 'the sample has its Account menu');
    {
      await btn.click(); await sp.waitForTimeout(600);
      const item = await sp.$('.mls-account-action[data-account-action="settings"]');
      assert.ok(item, 'the sample Account menu lists Account & security');
      await item.click({ force: true }); await sp.waitForTimeout(1200);
      const st = await sp.evaluate(() => ({ open: !!(document.getElementById('settingsModal') || { classList: { contains: () => false } }).classList.contains('show'), url: location.search }));
      assert.deepStrictEqual(st, { open: false, url: '?preview=1' }, 'Account & security does not open Settings in the sample');
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS patients and settings tell the truth: another MRN is another chart, a reused chart is named, impossible DOBs are refused, MM/DD/YYYY search finds the chart, Text size scales, the nub and the marks respect Settings, Cancel undoes previews, the phone Record button is clean, and the sample keeps Settings closed');
  } finally { await b.close(); srv.close(); }
});
