'use strict';
/* AI Studio and the Tools menu do what they say (studiofix-1.0.0, b1316).
   Measured on the signed-in 1p shell by the Studio hunt:
   - Practice: "Key trends" sat on "Reading your data..." forever (the loader
     list named renderKeyTrends, which does not exist) and the research
     registry never loaded (loadRegistry was not in the list); Export CSV then
     said "Registry still loading." forever;
   - "/" Find offered Admin (the owner's account-creation screen) to a
     non-admin, and the unreleased Team and Legal requests routes;
   - Study & build counted every appointment twice ("56 deduplicated visits"
     for 28 appointments);
   - Tools > Verify saved data rendered its result into a hidden node and
     Tools > Pull activity clicked a hidden <select>: both did nothing visible;
   - withheld Practice cards expanded to blank tiles and the Month & year
     report tile was titled "Untitled";
   - Escape did not close the Copilot drawer;
   - a stray "Ask MLS Copilot" chip stayed on screen after Find closed.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';

/* Practice's loader list names functions that exist */
const MERGE = fs.readFileSync(path.join(ROOT, 'feat_mls_studio_merge.js'), 'utf8');
const list = (MERGE.match(/\[('renderAnaKeyTrends'[^\]]*)\]\s*\.forEach/) || [])[1] || '';
assert.ok(/'loadRegistry'/.test(list) && !/'renderKeyTrends'/.test(list), 'Practice runs renderAnaKeyTrends and loadRegistry: ' + list);

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
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
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
    const load = (src) => pg.evaluate((src) => new Promise((r) => { const s = document.createElement('script'); s.src = src; s.onload = r; s.onerror = r; document.head.appendChild(s); }), src);
    for (const [g, src] of [['__mlsStudyRequest', '/feat_mls_study_request.js'], ['__mlsSaveVerify', '/feat_save_verify.js'], ['__mlsPullTarget', '/feat_mls_pull_device_picker.js']]) {
      if (!(await pg.evaluate((g) => !!window[g], g))) await load(src);
    }
    await pg.waitForTimeout(800);

    /* 1. the Practice loaders exist; an export with no registry says why */
    const reg = await pg.evaluate(async () => {
      const have = ['renderAnaKeyTrends', 'loadAnalysisBaseline', 'loadOutcomesMarketing', 'loadRegistry'].filter((f) => typeof window[f] !== 'function');
      await loadRegistry(true);
      let said = ''; const t0 = window.toast; window.toast = (m) => { said = String(m); }; exportRegistryCsv(); window.toast = t0;
      return { missing: have, said, body: (document.getElementById('anaRegistryBody') || {}).textContent || '' };
    });
    assert.deepStrictEqual(reg.missing, [], 'every Practice loader exists as named');
    assert.match(reg.body, /Could not load registry/, 'an unreachable registry says so');
    assert.ok(!/still loading/i.test(reg.said) && /could not be loaded/.test(reg.said), 'Export says the registry could not be loaded, not "still loading": ' + reg.said);

    /* 2. Find offers only routes this account can use */
    const find = await pg.evaluate(async () => {
      mlsQuickFind(); await new Promise((r) => setTimeout(r, 200));
      const ov = document.getElementById('mlsFpQf') || document.getElementById('mlsQf');
      const text = ov ? ov.textContent : '';
      try { mlsQuickFindClose && mlsQuickFindClose(); } catch (e) {}
      const k = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }); document.dispatchEvent(k);
      return { open: !!ov, admin: /🛡️\s*Admin/.test(text), team: /(^|\s)👥\s*Team/.test(text), legal: /Legal requests/.test(text) };
    });
    assert.ok(find.open, 'the Find palette opens');
    assert.deepStrictEqual({ admin: find.admin, team: find.team, legal: find.legal }, { admin: false, team: false, legal: false }, 'Find does not offer Admin, Team or Legal requests to this account');

    /* 3. one appointment is one visit in Study & build */
    const study = await pg.evaluate(() => {
      const S = window.__mlsStudyRequest; if (!S || typeof S.collectStoredRecords !== 'function') return null;
      const out = S.collectStoredRecords(window); const pts = out.patients || out;
      const ada = (Array.isArray(pts) ? pts : []).find((p) => /Ada Sample/.test(p.name || ''));
      const appts = (window._calAppts || []).filter((a) => /Ada Sample/.test(a.name || '')).length;
      return ada ? { visits: ada.visits.length, appts } : { visits: -1, appts };
    });
    assert.ok(study, 'the study collector is installed');
    assert.ok(study.appts >= 1, 'the seeded chart has appointments');
    assert.strictEqual(study.visits, study.appts, 'each appointment is counted once: ' + JSON.stringify(study));

    /* 4. Verify saved data says its result when the report is out of sight */
    const verify = await pg.evaluate(() => {
      const V = window.__mlsSaveVerify; if (!V || typeof V.scan !== 'function') return null;
      try { if (typeof selectPatient === 'function') window.__mlsPatientLock ? window.__mlsPatientLock.switchAsDoctor('syn-5') : selectPatient('syn-5'); } catch (e) {}
      const pc = document.getElementById('profileCard'); if (pc) pc.style.display = 'none';
      let said = ''; const t0 = window.toast; window.toast = (m) => { said = String(m); }; V.scan(); window.toast = t0;
      if (pc) pc.style.display = '';
      return said;
    });
    assert.ok(verify !== null, 'Verify saved data is installed');
    assert.ok(/saved|issue|Not found/i.test(verify), 'a hidden report is said as a notice: ' + verify);

    /* 5. the Copilot drawer closes on Escape */
    const cop = await pg.evaluate(async () => {
      openCopilotDock(); await new Promise((r) => setTimeout(r, 200));
      const was = document.getElementById('copilotDock').classList.contains('open');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      return { was, now: document.getElementById('copilotDock').classList.contains('open') };
    });
    assert.deepStrictEqual(cop, { was: true, now: false }, 'Escape closes the Copilot drawer');

    /* 6. no Ask chip after Find chose a result */
    await pg.evaluate(() => { document.body.focus(); });
    await pg.mouse.click(700, 60);
    await pg.keyboard.press('/'); await pg.waitForTimeout(250);
    await pg.keyboard.type('Ada'); await pg.waitForTimeout(250);
    await pg.keyboard.press('Enter'); await pg.waitForTimeout(400);
    const chip = await pg.evaluate(() => { const c = document.getElementById('mlsAskCopilotChip'); return !!(c && c.style.display !== 'none' && c.getClientRects().length); });
    assert.strictEqual(chip, false, 'no stray Ask MLS Copilot chip after Find picked a result');

    /* 7. a Tools row driving a hidden <select> offers its choices, and a choice
       goes to the select's OWNER, never through a synthesized event.
       Pull activity is #mlsPdpSel (feat_mls_pull_device_picker.js), hidden by
       the calm shell. Through b1336 the chooser set the value and faked a
       'change' event; ui-control-coverage forbids the shell from synthesizing
       events. The chooser now calls window.__mlsPullTarget.set() directly and
       keeps the select in step, so the pin is on what the doctor gets: the
       stored pull target, the live select, and zero synthesized events. */
    const pick = await pg.evaluate(async () => {
      const C = window.__mlsCalmShell, P = window.__mlsPullTarget;
      if (!C || typeof C.runControl !== 'function') return null;
      if (!P || typeof P.set !== 'function') return { picker: false };
      const KEY = 'mls_pull_target_device';
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const keep = localStorage.getItem(KEY);
      localStorage.removeItem(KEY);
      /* the picker paints its select next to the day bar's Pull button; the
         calm shell hides that spot, so a hidden host stands in for it */
      let host = null;
      if (!document.getElementById('mlsDsPullBtn')) {
        host = document.createElement('div'); host.style.display = 'none';
        const pb = document.createElement('button'); pb.type = 'button'; pb.id = 'mlsDsPullBtn'; pb.textContent = 'Pull';
        host.appendChild(pb); document.body.appendChild(host);
      }
      P.refresh(); await sleep(50);
      const wrap = document.getElementById('mlsPdpWrap');
      const wrapDisplay = wrap ? wrap.style.display : '';
      if (wrap) wrap.style.display = 'none';
      const live = () => document.getElementById('mlsPdpSel');
      let synthesized = 0;
      const count = (e) => { if (e.target && e.target.id === 'mlsPdpSel') synthesized++; };
      document.addEventListener('change', count, true);
      document.addEventListener('input', count, true);
      const choose = async (re) => {
        C.runControl(live()); await sleep(100);
        const d = document.getElementById('mlsSelPick');
        const shown = !!(d && d.getClientRects().length);
        const rows = d ? [...d.querySelectorAll('button')].map((x) => x.textContent.trim()) : [];
        const btn = d && [...d.querySelectorAll('button')].find((x) => re.test(x.textContent));
        if (btn) btn.click();
        await sleep(100);
        const n = document.getElementById('mlsNote');
        return { shown, rows, clicked: !!btn, closed: !document.getElementById('mlsSelPick'), note: n ? n.textContent : '' };
      };
      const out = { picker: true };
      try {
        /* a registered computer, as the picker lists one after /api/relay/devices */
        const opt = new Option('Front desk laptop (laptop/secondary)', 'dev-LAP');
        opt.setAttribute('data-name', 'Front desk laptop');
        live().add(opt);
        out.toLaptop = await choose(/Front desk laptop/);
        out.afterLaptop = { get: P.get(), stored: localStorage.getItem(KEY), selValue: live() && live().value };
        out.toAuto = await choose(/^(\u2713 )?Auto/);
        out.afterAuto = { get: P.get(), stored: localStorage.getItem(KEY), selValue: live() && live().value };
      } finally {
        document.removeEventListener('change', count, true);
        document.removeEventListener('input', count, true);
        if (keep === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, keep);
        if (wrap) wrap.style.display = wrapDisplay;
        if (host) host.remove();
        P.refresh();
      }
      out.synthesized = synthesized;

      /* a hidden select with no owner is shown, never driven */
      const sel = document.createElement('select'); sel.id = 'zzHiddenSel'; sel.setAttribute('aria-label', 'Some other choice');
      sel.innerHTML = '<option value="a">A</option><option value="b">B</option>';
      const box = document.createElement('div'); box.style.display = 'none'; box.appendChild(sel); document.body.appendChild(box);
      let other = 0; sel.addEventListener('change', () => { other++; }); sel.addEventListener('input', () => { other++; });
      C.runControl(sel); await sleep(100);
      const n2 = document.getElementById('mlsNote');
      out.noOwner = { chooser: !!document.getElementById('mlsSelPick'), value: sel.value, events: other, note: n2 ? n2.textContent : '' };
      box.remove();
      return out;
    });
    if (pick !== null) {
      assert.strictEqual(pick.picker, true, 'the pull-device picker (window.__mlsPullTarget) is installed');
      assert.deepStrictEqual(
        { shown: pick.toLaptop.shown, clicked: pick.toLaptop.clicked, closed: pick.toLaptop.closed },
        { shown: true, clicked: true, closed: true },
        'Pull activity opens a chooser listing the picker\'s choices, and choosing closes it: ' + JSON.stringify(pick.toLaptop));
      assert.ok(pick.toLaptop.rows.some((r) => /Auto/.test(r)), 'the chooser offers Auto: ' + JSON.stringify(pick.toLaptop.rows));
      assert.deepStrictEqual(pick.afterLaptop.get, { id: 'dev-LAP', name: 'Front desk laptop', self: false },
        'choosing a computer stores it through the picker\'s own set(), under the name the picker lists');
      assert.deepStrictEqual(JSON.parse(pick.afterLaptop.stored), { id: 'dev-LAP', name: 'Front desk laptop' },
        'the pull target is stored where the relay reads it');
      assert.strictEqual(pick.afterLaptop.selValue, 'dev-LAP', 'the real select shows the chosen computer');
      assert.match(pick.toLaptop.note, /Front desk laptop/, 'the choice is confirmed on screen');
      assert.deepStrictEqual(
        { shown: pick.toAuto.shown, clicked: pick.toAuto.clicked, closed: pick.toAuto.closed, get: pick.afterAuto.get, stored: pick.afterAuto.stored, selValue: pick.afterAuto.selValue },
        { shown: true, clicked: true, closed: true, get: null, stored: null, selValue: 'auto' },
        'choosing Auto clears the target and the real select reads Auto: ' + JSON.stringify(pick.afterAuto));
      assert.strictEqual(pick.synthesized, 0, 'no change or input event was synthesized on #mlsPdpSel');
      assert.deepStrictEqual(
        { chooser: pick.noOwner.chooser, value: pick.noOwner.value, events: pick.noOwner.events },
        { chooser: false, value: 'a', events: 0 },
        'a hidden select with no known owner is not proxied: no chooser, no value change, no synthesized event');
      assert.match(pick.noOwner.note, /cannot be changed from here/, 'and the doctor is told where to change it');
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS studio and tools do what they say: Practice loaders exist and a failed registry export says so, Find offers only usable routes, appointments count once, Verify speaks when its report is hidden, Escape closes Copilot, no stray Ask chip, and Pull activity opens a chooser that sets the pull target through its owner, with no synthesized event');
  } finally { await b.close(); srv.close(); }
});
