'use strict';
/* The Assistant, Copilot and Custom widgets answer (asstfix-1.0.0, b1317).
   Found by the Assistant/Tools hunt on the signed-in 1p shell:
   - the "Use MLS on your phone" card sat on Copilot's Send button: Send did
     nothing on desktop;
   - the Assistant's chat box showed on the Schedule tab ([hidden] lost to a
     display:flex rule) and a Send there vanished into the hidden Chat tab;
   - the Assistant panel ignored Escape and never took or returned focus;
     Copilot left focus inside its closed, off-screen drawer;
   - "Design my widget" failed with no word in the builder, and the notice it
     filed said "Could not generate the note: 503";
   - Escape on "Delete the widget?" also closed the widget builder beneath it;
   - the Assistant's day pull stayed on "Checking MLS Assist readiness..." and
     was described as a one-patient chart pull;
   - on a phone the Tools menu grew over the taskbar;
   - the builder said "Up to 10 widgets" to a Standard account capped at 5.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
assert.ok(/Up to 5 widgets on Standard, 10 on Premium/.test(SHELL) && !/Up to 10 widgets; they follow/.test(SHELL), 'the builder states the real widget limits');

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

    /* 1. the phone card stands down while Copilot is open; Copilot hands focus back */
    const cop = await pg.evaluate(async () => {
      let card = document.getElementById('mlsGetPhoneCard'), made = false;
      if (!card) { card = document.createElement('div'); card.id = 'mlsGetPhoneCard'; card.style.cssText = 'position:fixed;right:16px;bottom:16px;width:330px;height:145px;z-index:99996'; document.body.appendChild(card); made = true; }
      const opener = document.querySelector('#mlsDock button') || document.body; opener.focus();
      openCopilotDock(); await new Promise((r) => setTimeout(r, 250));
      const hiddenWhileOpen = getComputedStyle(card).display === 'none';
      closeCopilotDock(); await new Promise((r) => setTimeout(r, 50));
      const back = getComputedStyle(card).display !== 'none';
      const d = document.getElementById('copilotDock'), ae = document.activeElement;
      if (made) card.remove();
      return { hiddenWhileOpen, back, focusInClosedDrawer: !!(d && ae && d.contains(ae)) };
    });
    assert.deepStrictEqual(cop, { hiddenWhileOpen: true, back: true, focusInClosedDrawer: false }, 'the phone card steps aside for Copilot and focus leaves the closed drawer');

    /* 2. Assistant: no chat box on Schedule; Escape closes; focus goes in */
    const asst = await pg.evaluate(async () => {
      const A = window.__mlsAsst; if (!A || !A.installed || typeof A.open !== 'function') return null;
      A.open(); await new Promise((r) => setTimeout(r, 300));
      const p = document.getElementById('mlsAsstPanel');
      const sched = p.querySelector('.as-tab[data-tab="schedule"], [data-tab="schedule"]'); if (sched) sched.click();
      await new Promise((r) => setTimeout(r, 150));
      const box = p.querySelector('.as-input');
      const boxShown = !!(box && getComputedStyle(box).display !== 'none');
      const focusIn = p.contains(document.activeElement);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      return { boxShown, focusIn, openAfterEsc: p.classList.contains('open'), role: p.getAttribute('role') };
    });
    assert.ok(asst, 'the MLS Assistant is installed');
    assert.deepStrictEqual(asst, { boxShown: false, focusIn: true, openAfterEsc: false, role: 'dialog' }, 'Assistant hides the chat box on Schedule, takes focus, and closes on Escape');

    /* 3. the day pull is described as a day pull */
    const pull = await pg.evaluate(() => { const b = document.querySelector('#mlsAsstPanel .as-pullbtn'); return b ? (b.getAttribute('title') || b.textContent) : null; });
    assert.ok(pull !== null, 'the Assistant has its day pull');
    assert.ok(!/this patient/i.test(pull), 'the Assistant day pull is not described as a one-patient chart pull: ' + pull);

    /* 4. a failed widget design says so in the builder */
    const wid = await pg.evaluate(async () => {
      if (typeof openWidgetBuilder !== 'function') return null;
      openWidgetBuilder(); await new Promise((r) => setTimeout(r, 300));
      const d = document.getElementById('cwDescribe'); if (!d) return null;
      d.value = 'A card with the pain score trend';
      const had = window.hasAI, call = window.aiCallRaw;
      window.hasAI = () => true; window.aiCallRaw = async () => { throw new Error('Request failed (503)'); };
      try { await designCustomWidget(); } finally { window.hasAI = had; window.aiCallRaw = call; }
      const s = document.getElementById('cwDesignStatus');
      return { shown: !!(s && !s.hidden && s.getClientRects().length), text: s ? s.textContent : '' };
    });
    assert.ok(wid, 'the widget builder opens');
    {
      assert.ok(wid.shown, 'the builder shows the failure');
      assert.ok(/widget/i.test(wid.text) && !/generate the note/i.test(wid.text), 'the failure names the widget, not a note: ' + wid.text);
    }

    /* 5. Escape on a confirm over the builder closes only the confirm */
    const esc = await pg.evaluate(async () => {
      const m = document.getElementById('widgetBuilderModal'); if (!m || !m.classList.contains('show')) return null;
      const ask = mlsConfirm('Delete the widget?'); await new Promise((r) => setTimeout(r, 100));
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const v = await ask; await new Promise((r) => setTimeout(r, 100));
      return { answered: v, builderOpen: m.classList.contains('show') };
    });
    assert.ok(esc, 'the widget builder is open for the confirm check');
    assert.deepStrictEqual(esc, { answered: false, builderOpen: true }, 'Escape cancels the confirm and leaves the builder open');

    /* 6. phone: the Tools menu stops above the taskbar */
    const ph = await boot({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const tb = await ph.$('#mlsDock button[data-dest="tools"]');
    assert.ok(tb, 'the phone taskbar has Tools');
    await tb.click(); await ph.waitForTimeout(600);
    const menu = await ph.evaluate(() => {
      const m = document.getElementById('mlsToolsMenu'), d = document.getElementById('mlsDock');
      if (!m || !d) return null; const mr = m.getBoundingClientRect(), dr = d.getBoundingClientRect();
      return { menuBottom: Math.round(mr.bottom), dockTop: Math.round(dr.top), band: document.documentElement.getAttribute('data-mls-dock-band') };
    });
    assert.ok(menu, 'the Tools menu opens on the phone');
    if (menu.band === 'bottom') assert.ok(menu.menuBottom <= menu.dockTop, 'the Tools menu ends above the taskbar: ' + JSON.stringify(menu));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS assistant and widgets answer: the phone card steps aside for Copilot, the Assistant hides its chat box on Schedule and works from the keyboard, a failed widget design says so in the builder, Escape on a confirm spares the builder, and the phone Tools menu stays above the taskbar');
  } finally { await b.close(); srv.close(); }
});
