'use strict';
/* Team notes open when pressed and keep what is being typed (stafffix-1.0.0,
   2026-09-23). Found by the Copilot / staff hunt on the signed-in 1p shell:
   - pressing "Team notes" blanked the whole section: the calm shell's
     profile-card fold adopted #pf2TeamNotes the moment it opened (heading +
     body = two children), hid the body and the module's own toggle button, and
     once its chevron was closed EVERY patient's Team notes box was an empty
     rounded box with no title and no count;
   - a half-typed note was erased when the AI visit summary landed, or on any
     other repaint of the card (sync, another tab, renderProfile): the box was
     refilled from a stale stash taken at click time. The edit box did the same.
   Desktop 1400x900 and phone 390x844. Real Chrome; the AI is stubbed through
   window.aiCallRaw and nothing leaves 127.0.0.1. */
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
  const boot = async (ctxOpts, fullApp) => {
    const ctx = await b.newContext(ctxOpts);
    /* A signed-in phone gets the phone app, which has its own team-notes
       surface; the patient card is on a phone once the doctor picks "Show the
       full app" (Settings -> This device), which is this stored preference. */
    if (fullApp) await ctx.addInitScript(() => { try { localStorage.setItem('mls_layout_pref', 'full'); } catch (e) {} });
    const pg = await ctx.newPage();
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
    await pg.waitForTimeout(800);
    /* A signed-in session for the AI button, the AI held open until the test
       answers, and the team-notes module (deferred past first paint in the
       real app, so it is loaded here the way its loader does). */
    await pg.evaluate(async () => {
      sessionStorage.setItem('sf_bk_token', 'synthetic-token');
      window.aiCallRaw = function () { return new Promise((res) => { window.__aiAnswer = res; }); };
      if (!window.__mlsTeamNotes) {
        const s = document.createElement('script');
        s.src = 'feat_mls_team_notes.js?v=' + Date.now(); s.setAttribute('data-mls-asset', 'feat_mls_team_notes.js');
        document.body.appendChild(s); await new Promise((r) => { s.onload = r; });
      }
      const ps = getPatients(); const p = ps.find((x) => x.id === 'syn-0');
      p.teamNotes = [{ v: 1, id: 'tn_seed_1', at: Date.now() - 60000, author: 'Dr Beta', text: 'Watch INR before the injection.', ai: false }];
      savePatients(ps);
    });
    return pg;
  };
  const open = async (pg, id) => {
    await pg.evaluate(async (pid) => { window.__mlsPatientLock.switchAsDoctor(pid); await new Promise((r) => setTimeout(r, 500)); showView('patients'); }, id);
    await pg.waitForTimeout(1000);
  };
  const box = (pg) => pg.evaluate(() => {
    const el = document.getElementById('pf2TeamNotes');
    const bt = el && el.querySelector('[data-tn-act=toggle]');
    return {
      folded: !!(el && el.classList.contains('mls-fold')),
      headFolded: !!(el && el.firstElementChild && el.firstElementChild.classList.contains('mls-fold-hd')),
      toggle: !!(bt && window.__clunky.visible(bt)),
      label: bt && window.__clunky.visible(bt) ? bt.innerText.replace(/\s+/g, ' ').trim() : '',
      body: window.__clunky.visible(document.getElementById('mlsTnBody'))
    };
  });

  try {
    for (const [tag, ctxOpts] of [
      ['desktop', { viewport: { width: 1400, height: 900 } }],
      ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }]
    ]) {
      const pg = await boot(ctxOpts, tag === 'phone');
      await open(pg, 'syn-0');

      /* 1. the collapsed header reads its count */
      let s = await box(pg);
      assert.ok(s.toggle && /Team notes/.test(s.label) && /\b1\b/.test(s.label), tag + ': the collapsed header shows "Team notes 1": ' + JSON.stringify(s));

      /* 2. pressing it opens the thread, and the calm pass does not fold it away */
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click();
      await pg.waitForTimeout(1200);
      s = await box(pg);
      assert.ok(s.body && s.toggle && !s.folded, tag + ': pressing Team notes opens the thread with its header still there: ' + JSON.stringify(s));

      /* 3. a half-typed note survives the AI summary landing */
      await pg.locator('#mlsTnAiBtn').click();
      await pg.waitForTimeout(300);
      const typed = 'Dr Beta - please call the pharmacy about the refill before Friday';
      await pg.locator('#mlsTnNew').click();
      await pg.keyboard.type(typed, { delay: 2 });
      await pg.evaluate(() => window.__aiAnswer('Ada Sample is a patient with little documented in the record.'));
      await pg.waitForTimeout(800);
      const afterAi = await pg.evaluate(() => ({
        text: (document.getElementById('mlsTnNew') || {}).value,
        focus: document.activeElement && document.activeElement.id,
        stored: (getPatients().find((p) => p.id === 'syn-0').teamNotes || []).filter((n) => !n.del).map((n) => ({ ai: n.ai === true, text: n.text }))
      }));
      assert.strictEqual(afterAi.text, typed, tag + ': the note being typed is still in the box after the summary lands: ' + JSON.stringify(afterAi));
      assert.ok(afterAi.stored.some((n) => n.ai && /Ada Sample/.test(n.text)), tag + ': the summary was added as an AI note');
      assert.ok(!afterAi.stored.some((n) => n.text.indexOf('pharmacy') !== -1), tag + ': the half-typed note was not saved on its own');
      assert.strictEqual(afterAi.focus, 'mlsTnNew', tag + ': the cursor stays in the box, so typing carries on');
      await pg.keyboard.type(' please', { delay: 2 });
      assert.strictEqual(await pg.inputValue('#mlsTnNew'), typed + ' please', tag + ': typing after the repaint continues where it left off');

      /* 4. any other repaint keeps the note box, the From name and the edit box */
      await pg.locator('#mlsTnAuthor').fill('Dr Gamma');
      await pg.evaluate(() => renderProfile());
      await pg.waitForTimeout(300);
      assert.deepStrictEqual(await pg.evaluate(() => [document.getElementById('mlsTnNew').value, document.getElementById('mlsTnAuthor').value]),
        [typed + ' please', 'Dr Gamma'], tag + ': a renderProfile repaint keeps the note and the From name');
      await pg.locator('#pf2TeamNotes [data-tn-act=edit][data-tn-id=tn_seed_1]').click();
      await pg.waitForTimeout(200);
      await pg.locator('#mlsTnEditText').fill('Watch INR before the injection. Recheck on Monday.');
      await pg.evaluate(() => renderProfile());
      await pg.waitForTimeout(300);
      assert.strictEqual(await pg.inputValue('#mlsTnEditText'), 'Watch INR before the injection. Recheck on Monday.', tag + ': a repaint keeps an edit in progress');
      await pg.locator('#pf2TeamNotes [data-tn-act=editcancel]').click();
      await pg.waitForTimeout(200);
      await pg.locator('#pf2TeamNotes [data-tn-act=edit][data-tn-id=tn_seed_1]').click();
      await pg.waitForTimeout(200);
      assert.strictEqual(await pg.inputValue('#mlsTnEditText'), 'Watch INR before the injection.', tag + ': a cancelled edit is not brought back the next time');
      await pg.locator('#pf2TeamNotes [data-tn-act=editcancel]').click();
      await pg.waitForTimeout(200);

      /* 5. saving still empties the box - the saved note does not come back as a draft */
      await pg.locator('#mlsTnNew').click();
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(500);
      const saved = await pg.evaluate(() => ({
        box: document.getElementById('mlsTnNew').value,
        stored: (getPatients().find((p) => p.id === 'syn-0').teamNotes || []).filter((n) => !n.del && !n.ai).map((n) => n.author + ': ' + n.text)
      }));
      assert.strictEqual(saved.box, '', tag + ': the box is empty after the note is added');
      assert.ok(saved.stored.indexOf('Dr Gamma: ' + typed + ' please') !== -1, tag + ': the typed note was saved with its From name: ' + JSON.stringify(saved.stored));

      /* 6. closing it keeps the header and its count, on this patient and every other */
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click();
      await pg.waitForTimeout(1200);
      s = await box(pg);
      assert.ok(s.toggle && !s.body && !s.folded && /Team notes\s*3/.test(s.label), tag + ': closed, the header reads "Team notes 3": ' + JSON.stringify(s));
      await open(pg, 'syn-1');
      s = await box(pg);
      assert.ok(s.toggle && /Team notes/.test(s.label) && /none yet/.test(s.label), tag + ': another patient shows its own header: ' + JSON.stringify(s));
      await open(pg, 'syn-0');
      s = await box(pg);
      assert.ok(s.toggle && /Team notes\s*3/.test(s.label), tag + ': back on the first patient, the count is still there: ' + JSON.stringify(s));

      /* 6b. a half-typed note on one patient survives reading another patient's
         Team notes (the draft slot is per patient) */
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click(); await pg.waitForTimeout(800);
      await pg.fill('#mlsTnNew', 'A-DRAFT-PEEK');
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click(); await pg.waitForTimeout(800);
      await open(pg, 'syn-1');
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click(); await pg.waitForTimeout(800);
      await open(pg, 'syn-0');
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click(); await pg.waitForTimeout(800);
      const peek = await pg.evaluate(() => (document.getElementById('mlsTnNew') || {}).value);
      assert.strictEqual(peek, 'A-DRAFT-PEEK', tag + ': reading another patient\'s Team notes keeps the note being written for this one');
      await pg.fill('#mlsTnNew', '');
      await pg.locator('#pf2TeamNotes [data-tn-act=toggle]').click(); await pg.waitForTimeout(600);

      /* 7. a box an older pass already folded is handed back */
      const healed = await pg.evaluate(async () => {
        const el = document.getElementById('pf2TeamNotes'), hd = el.firstElementChild;
        el.classList.add('mls-fold'); hd.classList.add('mls-fold-hd'); hd.setAttribute('role', 'button'); hd.setAttribute('tabindex', '0'); hd.setAttribute('aria-expanded', 'false');
        window.__mlsCalmShell.render();
        await new Promise((r) => setTimeout(r, 200));
        return { fold: el.classList.contains('mls-fold'), hd: hd.classList.contains('mls-fold-hd'), role: hd.getAttribute('role'), shown: window.__clunky.visible(el.querySelector('[data-tn-act=toggle]')) };
      });
      assert.deepStrictEqual(healed, { fold: false, hd: false, role: null, shown: true }, tag + ': a Team notes box stamped as a fold by an earlier pass is un-stamped');
      await pg.context().close();
    }

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS team notes: pressing Team notes opens the thread and the collapsed header keeps its count on every patient (desktop and phone), and a half-typed note, its From name and an edit in progress survive the AI summary landing and any repaint, while a saved note still leaves the box');
  } finally { await b.close(); srv.close(); }
});
