'use strict';
/* Screens say what is true (samplekey-1.0.0, nextglow-1.1.1, homeline-1.0.0,
   colalign-1.0.0, phdock-1.0.0, pvfix-1.0.1). Found by the ScribeFlow.html UI
   critique, each measured on /ScribeFlow.html?preview=1:
   - Settings in the sample asked for an OpenAI API key nothing in it uses;
   - the Settings rail centred every tab label; its NEXT glow sat on the open
     Account tab ("close when you are done"), then on "Watch the walkthrough";
   - the Patient list's NEXT glow lit whoever sorts first by name as "the
     patient you are about to see" while the brief named someone else;
   - Visit: a greyed "Start Recording" with no reason, a banner saying "choose
     a patient" over an open patient, and "Your athenaOne view (default) ·
     identity guards active" in a workspace with no athenaOne;
   - the patient bar ran 103-1283 over a workspace at 156-1358;
   - Display: a "Navigation layout" dropdown that changes nothing beside the
     taskbar field, which was named "Navigation bar" and said it "keeps
     hovering over the page" next to options that never cover it;
   - phone: five dock buttons packed into the left 236px of a 370px bar, and
     the Activity chip floating over the visit hero.
   Real Chrome, 1400x900 and 390x844. Nothing leaves 127.0.0.1. */
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
  async function open(mobile) {
    const ctx = await b.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }
      : { viewport: { width: 1400, height: 900 } });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push((mobile ? 'phone: ' : 'desk: ') + String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/ScribeFlow.html?preview=1');
    await pg.waitForFunction(() => (window._calAppts || []).length > 0 && typeof window.showView === 'function' && !!window.__mlsNextGlow, null, { timeout: 60000 });
    await pg.waitForTimeout(2500);
    return pg;
  }
  try {
    const pg = await open(false);

    /* 1. Visit: the hero says why it is off; the banner and status line are true */
    await pg.evaluate(() => showView('visit')); await pg.waitForTimeout(1200);
    const v = await pg.evaluate(() => ({
      hero: (document.getElementById('ez3ActiveGo') || {}).textContent || '',
      heroName: (document.getElementById('ez3ActiveGo') || { getAttribute() { return ''; } }).getAttribute('aria-label') || '',
      card: (document.querySelector('.mls-idcard .mls-idname') || {}).textContent || '',
      banner: (document.getElementById('mlsPrfProgress') || {}).textContent || '',
      chooser: (() => { const c = document.getElementById('ez3Choose'); return c ? { alt: c.classList.contains('alt'), bg: getComputedStyle(c).backgroundImage + '|' + getComputedStyle(c).backgroundColor } : null; })(),
      status: (document.getElementById('ez3HomeStatus') || {}).textContent || '',
      bar: (() => { const r = document.getElementById('mlsCtxBar').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; })(),
      view: (() => { const r = document.getElementById('visitView').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; })(),
    }));
    if (v.hero) {
      assert.match(v.hero, /recording off/i, 'the sample hero says recording is off, not a greyed "Start Recording": ' + v.hero);
      assert.ok(v.card && v.heroName.indexOf(v.card) >= 0, 'the hero still names its patient (identity card and aria-label): ' + JSON.stringify(v));
    }
    assert.doesNotMatch(v.banner, /choose a patient/i, 'no "choose a patient" over an open patient: ' + v.banner);
    /* chooser-1.0.0 (b1308): under the patient's own action, Choose patient is the outlined secondary, not the brightest control */
    if (v.hero && v.chooser) assert.ok(v.chooser.alt && /^none\|rgb\(255, 255, 255\)/.test(v.chooser.bg), 'Choose patient outshouts the patient\'s own action: ' + JSON.stringify(v.chooser));
    assert.doesNotMatch(v.status, /athenaOne|identity guards active/, 'the sample status line claims no athenaOne and no always-on guard: ' + v.status);
    assert.match(v.status, /Sample schedule/, 'the sample status line says whose schedule it is: ' + v.status);
    assert.ok(Math.abs(v.bar[0] - v.view[0]) <= 1 && Math.abs(v.bar[1] - v.view[1]) <= 1, 'the patient bar shares the workspace column: bar ' + v.bar + ' vs view ' + v.view);

    /* 2. Patients: the NEXT glow is the patient the brief names */
    await pg.evaluate(() => showView('patients')); await pg.waitForTimeout(1500);
    const pt = await pg.evaluate(() => {
      window.__mlsNextGlow.refresh();
      const on = document.querySelector('[data-mls-next="1"]');
      const brief = document.getElementById('dailyBriefBar');
      return { next: brief ? brief.getAttribute('data-next-patient') : null, litId: on ? on.getAttribute('data-patient-id') : null, litTag: on ? on.id || on.className : null, first: (document.querySelector('#ptList .pt-item[data-patient-id]') || {}).getAttribute('data-patient-id') };
    });
    if (pt.litId) assert.strictEqual(pt.litId, pt.next, 'the glowing patient is the one the brief names as Next: ' + JSON.stringify(pt));
    if (!pt.next) assert.ok(!pt.litId, 'with no next patient no row is invented as next: ' + JSON.stringify(pt));

    /* 3. Settings: no OpenAI key in the sample, tabs read left, no glow on a tab or the x */
    await pg.evaluate(() => openSettings({ userInitiated: true })); await pg.waitForTimeout(1200);
    const st = await pg.evaluate(() => {
      const shown = (id) => { const e = document.getElementById(id); return !!(e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none'); };
      const tabs = Array.from(document.querySelectorAll('#settingsModal [role=tab]')).filter((t) => t.getBoundingClientRect().width > 0);
      const offs = tabs.map((t) => { const lb = t.querySelector('.mls-set-ic') || t.firstElementChild || t; return Math.round(lb.getBoundingClientRect().left - t.getBoundingClientRect().left); });
      window.__mlsNextGlow.refresh();
      const on = document.querySelector('[data-mls-next="1"]');
      return { key: shown('apiKeyField'), hint: shown('keyHint'), intro: shown('settingsIntro'), sample: shown('sampleAiNotice'), offs, lit: on ? (on.getAttribute('role') || '') + '|' + on.className + '|' + on.textContent.trim().slice(0, 30) : '' };
    });
    assert.ok(!st.key && !st.hint && !st.intro, 'the sample asks for no OpenAI API key: ' + JSON.stringify(st));
    assert.ok(st.sample, 'the sample says why no key is needed');
    assert.ok(st.offs.length >= 5 && Math.max.apply(null, st.offs) - Math.min.apply(null, st.offs) <= 2, 'every Settings tab label starts at the same left edge: ' + JSON.stringify(st.offs));
    assert.ok(!/^tab\|/.test(st.lit) && !/modal-x|Watch the walkthrough/.test(st.lit), 'with nothing to save no tab, x or walkthrough is lit as NEXT: ' + st.lit);

    /* 4. Display tab: one taskbar field, named and described truthfully */
    await pg.evaluate(() => { const t = Array.from(document.querySelectorAll('#settingsModal [role=tab]')).find((x) => /What you see|Display/.test(x.textContent)); if (t) t.click(); });
    await pg.waitForTimeout(700);
    const disp = await pg.evaluate(() => {
      const nav = document.getElementById('navLayoutSel'), dock = document.getElementById('qolDockSide');
      const f = dock.closest('.field');
      return { navShown: !!(nav && nav.getBoundingClientRect().height > 0), label: f.querySelector('label').textContent, note: f.textContent };
    });
    assert.ok(!disp.navShown, 'the dead "Navigation layout" dropdown is not offered beside the taskbar field');
    assert.match(disp.label, /^Taskbar \(quick buttons\) position/, 'the taskbar field is named for what it moves: ' + disp.label);
    assert.doesNotMatch(disp.note, /keeps hovering over the page wherever you put it/, 'the note does not contradict the side options');
    await pg.evaluate(() => { try { closeSettings(); } catch (e) {} });

    /* 5. phone: the dock fills its bar and the Activity chip does not float over the page */
    const ph = await open(true);
    await ph.evaluate(() => showView('visit')); await ph.waitForTimeout(1200);
    const dock = await ph.evaluate(() => {
      const d = document.getElementById('mlsDock'), dr = d.getBoundingClientRect();
      const btns = Array.from(d.children).filter((k) => k.tagName === 'BUTTON' && k.getBoundingClientRect().width > 0);
      const last = btns[btns.length - 1].getBoundingClientRect(), first = btns[0].getBoundingClientRect();
      const tray = document.getElementById('mlsTray');
      return { dock: [Math.round(dr.left), Math.round(dr.right)], first: Math.round(first.left), last: Math.round(last.right), n: btns.length, tray: !!(tray && tray.getBoundingClientRect().width > 0) };
    });
    assert.ok(dock.n >= 4 && dock.dock[1] - dock.last <= 24 && dock.first - dock.dock[0] <= 24, 'the phone dock buttons fill the bar instead of packing left: ' + JSON.stringify(dock));
    assert.ok(!dock.tray, 'the Activity chip does not float over the phone screen');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS screens say what is true: the sample asks for no API key and says why recording is off, the status line and banner are true, the NEXT glow is the patient the brief names and never a tab or the x, Settings tabs read left, the patient bar shares the workspace column, Display offers one truthfully named taskbar field, and the phone dock fills its bar with no chip over the page');
  } finally { await b.close(); srv.close(); }
});
