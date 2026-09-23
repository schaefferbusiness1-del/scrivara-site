'use strict';
/* Errors reach the doctor, and orders survive a patient switch (errfix-1.0.0,
   b1318). Found by the Orders / Recommendations / Analysis hunt on the
   signed-in 1p shell:
   - orders built for a patient were cleared by a patient switch with no word
     (saveDraft refuses without a transcript or note);
   - "Generate Recommendations" failed silently: its error went only to the
     Activity tray (not on screen at all on a phone), worded "Could not
     generate the note: 503"; five more Orders/Practice presses did the same;
   - for a non-Premium account the AI Studio lock disabled every Practice tile
     (the old Analysis view), even Key trends and Baseline;
   - Practice showed two "Analysis" headings, one taking a tile cell;
   - printed letterheads read "Physical Medicine &amp; Rehabilitation";
   - the phone header cut "Recommendations" mid-letter.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
assert.ok(!/esc\([^)]*'Physical Medicine &amp; Rehabilitation'\)/.test(SHELL), 'no letterhead escapes an already-escaped ampersand');
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
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
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
    return pg;
  };
  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });

    /* 1. friendlyError names the caller's action and what a bare 5xx means */
    const fe = await pg.evaluate(() => ({
      recs: friendlyError(new Error('Request failed (503)'), 'generate recommendations'),
      bare: friendlyError(new Error('Request failed (503)')),
      other: friendlyError(new Error('Unexpected token < in JSON'), 'design the widget')
    }));
    assert.match(fe.recs, /^Could not generate recommendations: the MLS server did not answer/, 'the recommendations error names recommendations: ' + fe.recs);
    assert.ok(!/generate the note/i.test(fe.bare + fe.other), 'no error that is not about a note says "generate the note": ' + JSON.stringify(fe));

    /* 2. an error that answers a press is on screen, not only in the tray */
    await pg.mouse.click(700, 40);
    const shown = await pg.evaluate(async () => {
      toast('Referral outcome reports are a Premium feature.', 'err');
      await new Promise((r) => setTimeout(r, 150));
      const t = document.getElementById('toast');
      return !!(t && /Premium feature/.test(t.textContent) && t.getClientRects().length && getComputedStyle(t).display !== 'none');
    });
    assert.ok(shown, 'an error that answers a press is shown where the doctor is looking');

    /* 3. orders alone survive a patient switch */
    const kept = await pg.evaluate(async () => {
      window.__mlsPatientLock.switchAsDoctor('syn-0'); await new Promise((r) => setTimeout(r, 300));
      try { newVisit(); } catch (e) {}
      currentOrders.push({ id: 'ord-test-1', type: 'medication', fields: { drug: 'Gabapentin', dose: '300 mg' } });
      window.__mlsPatientLock.switchAsDoctor('syn-1'); await new Promise((r) => setTimeout(r, 400));
      const withOrders = getNotes().filter((n) => n.patientId === 'syn-0' && Array.isArray(n.orders) && n.orders.some((o) => o.id === 'ord-test-1'));
      return { saved: withOrders.length, clearedForNewPatient: currentOrders.length === 0 };
    });
    assert.deepStrictEqual(kept, { saved: 1, clearedForNewPatient: true }, 'orders built for the old patient are saved to their history before the switch clears them');

    /* 4. the AI Studio lock does not take Practice with it */
    const lock = await pg.evaluate(async () => {
      const L = window.__mlsStudioLock; if (!L || typeof L.apply !== 'function') return null;
      try { showView('studio'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 600));
      const prevUser = (typeof bkUser !== 'undefined') ? bkUser : undefined;
      const prevEP = window.effectivePremium;
      try { bkUser = { email: 'std@mlsscribe.test', premium: false }; } catch (e) {}
      window.effectivePremium = () => false;
      L.apply();
      const av = document.getElementById('analysisView'), sv = document.getElementById('studioView');
      const inPractice = av ? [...av.querySelectorAll('button')].filter((x) => x.hasAttribute('data-mls-prem-dis')).length : -1;
      const tabs = [...document.querySelectorAll('#mlsSmTabs button')].filter((x) => x.disabled).length;
      const lockedElsewhere = sv ? [...sv.querySelectorAll('[data-mls-prem-dis]')].filter((x) => !(av && av.contains(x))).length : 0;
      window.effectivePremium = prevEP; try { bkUser = prevUser; } catch (e) {}
      L.apply();
      return { inPractice, tabs, lockedElsewhere, dimmed: !!(av && av.getAttribute('data-mls-prem-dim')) };
    });
    assert.ok(lock, 'the AI Studio lock is installed');
    assert.strictEqual(lock.inPractice, 0, 'no Practice control is locked for a non-Premium account: ' + JSON.stringify(lock));
    assert.strictEqual(lock.tabs, 0, 'the AI Studio tabs stay usable, so Practice can be reached');
    assert.strictEqual(lock.dimmed, false, 'Practice is not dimmed');
    assert.ok(lock.lockedElsewhere > 0, 'the rest of AI Studio is still locked for that account');

    /* 5. one Analysis heading */
    const heads = await pg.evaluate(async () => {
      try { showView('analysis'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1500));
      const av = document.getElementById('analysisView'); if (!av) return null;
      const h = [...av.querySelectorAll('h1')].filter((x) => x.getClientRects().length && getComputedStyle(x).display !== 'none');
      return { n: h.length, stray: !!(av.querySelector(':scope > .ax-title') && av.querySelector(':scope > .anp-glyph-row')) };
    });
    assert.ok(heads, 'Practice renders');
    assert.ok(heads.n <= 1 && !heads.stray, 'Practice has one heading and no stray heading row: ' + JSON.stringify(heads));

    /* 6. phone: the header title ellipsizes */
    const ph = await boot({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const title = await ph.evaluate(async () => {
      try { showView('recs'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 800));
      const t = document.querySelector('#mlsRdTitle .rd-titletext'); if (!t) return null;
      const cs = getComputedStyle(t);
      return { text: t.textContent, overflow: cs.textOverflow, clipped: t.scrollWidth > t.clientWidth + 1 };
    });
    assert.ok(title, 'the phone header has its title text');
    assert.ok(!title.clipped || title.overflow === 'ellipsis', 'a long phone title ends in an ellipsis, not mid-letter: ' + JSON.stringify(title));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS errors reach the doctor: errors name their action and are shown when they answer a press, orders survive a patient switch, Practice is not caught by the AI Studio lock, one Practice heading, clean letterheads, and phone titles ellipsize');
  } finally { await b.close(); srv.close(); }
});
