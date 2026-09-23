'use strict';
/* The phone op-note room shows the day, and Settings names real places
   (opphone-1.0.0, b1304). Measured on /ScribeFlow.html?preview=1 at 390x844:
   - with no note open the day list was capped at 34vh inside its own
     scroller: one patient of four visible, the rest of the screen given to a
     one-card "pick a patient" pane; the taskbar covered the room's foot;
   - the open note's state chip ("No op note needed - this is scheduled as
     ..., not a procedure") ran off the right edge (nowrap, 406px on 390);
   - Settings said "📄 Templates (off by default)" while useTemplatesOn()
     defaults ON, sent doctors to "Menu → 📄 Templates" (the Tools menu has no
     such row) and to a "＋ Custom widget button in the header" (hidden in this
     shell; it is Tools → Custom widget), and promised "Help" was always
     available (it is not on the taskbar). */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
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
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/New_York',
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
    const pg = await ctx.newPage();
    await pg.clock.install({ time: new Date('2026-09-22T09:00:00-04:00') });
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/ScribeFlow.html?preview=1');
    await pg.waitForFunction(() => (window._calAppts || []).length > 0 && typeof window.openOpPrep === 'function', null, { timeout: 60000 });
    await pg.waitForTimeout(2500);

    /* 1. no note open: the whole day is on the page, not in a 34vh box */
    await pg.evaluate(() => openOpPrep()); await pg.waitForTimeout(2500);
    const list = await pg.evaluate(() => {
      const m = document.getElementById('opPrepModal');
      const rail = document.getElementById('oprDayRail'), grid = document.getElementById('mlsOpDayGrid');
      const r = (e) => e.getBoundingClientRect();
      return { state: m.getAttribute('data-mls-opnotes-state'), rail: Math.round(r(rail).height), railScroll: rail.scrollHeight - rail.clientHeight,
        gridBottom: Math.round(r(grid).bottom), railBottom: Math.round(r(rail).bottom), rows: grid.children.length,
        pad: getComputedStyle(m.querySelector('.modal')).paddingBottom, band: document.documentElement.getAttribute('data-mls-dock-band') };
    });
    assert.ok(/^(list|empty)$/.test(list.state), 'the room opens on its day list: ' + list.state);
    assert.ok(list.rows >= 4, 'the sample day has its four rows: ' + JSON.stringify(list));
    assert.ok(list.railScroll <= 1 && list.gridBottom <= list.railBottom + 1, 'every row of the day is in the list itself, not behind an inner scroller: ' + JSON.stringify(list));
    if (list.band === 'bottom') assert.notStrictEqual(list.pad, '0px', 'the room keeps the taskbar band clear: ' + JSON.stringify(list));

    /* 2. a note open: the split view returns and the state chip fits */
    await pg.evaluate(() => { const r = document.querySelector('#mlsOpDayGrid > *'); if (r) r.click(); }); await pg.waitForTimeout(1500);
    const note = await pg.evaluate(() => {
      const c = document.getElementById('mlsOpnState'), rail = document.getElementById('oprDayRail');
      return { state: document.getElementById('opPrepModal').getAttribute('data-mls-opnotes-state'), chipRight: c ? Math.round(c.getBoundingClientRect().right) : 0, rail: Math.round(rail.getBoundingClientRect().height), vw: innerWidth };
    });
    assert.strictEqual(note.state, 'note', 'pressing a row opens its note');
    assert.ok(note.chipRight <= note.vw, 'the note state chip stays on screen: ' + JSON.stringify(note));
    assert.ok(note.rail < 0.45 * 844, 'with a note open the list gives the note the room again: ' + JSON.stringify(note));

    /* 3. Settings names places that exist and defaults that are true */
    const words = await pg.evaluate(() => {
      const f = document.getElementById('featTplUse'), field = f && f.closest('.field');
      const text = (document.getElementById('settingsModal') || document.body).textContent;
      let saved = null; try { saved = localStorage.getItem(uns('useTemplates')); } catch (e) {}
      return { tplLabel: field ? field.textContent : '', defaultOn: saved == null ? useTemplatesOn() : null,
        menuTemplates: /manage templates under Menu/.test(text), headerWidget: /Custom widget<\/b> button in the header|Custom widget button in the header/.test(text),
        helpAlways: /Help are always available/.test(text), toolsWidget: /Tools → 🧩 Custom widget/.test(text) };
    });
    if (words.defaultOn === true) assert.match(words.tplLabel, /\(on by default\)/, 'the Templates switch states its real default: ' + words.tplLabel);
    assert.ok(!words.menuTemplates && !words.headerWidget && !words.helpAlways, 'Settings sends no one to a control that is not there: ' + JSON.stringify(words));
    assert.ok(words.toolsWidget, 'Custom widgets are named where they are: Tools → Custom widget');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS phone op-note room and Settings words: the day list shows every patient without an inner scroller, the room clears the taskbar, the open note chip fits, and Settings names real places and the Templates default truthfully');
  } finally { await b.close(); srv.close(); }
});
