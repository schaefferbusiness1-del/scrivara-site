'use strict';
/* Calendar and Admin say each thing once, and say it true (uifix-1.0.0,
   2026-09-24). Found by the real-Chrome audit of the screens outside Visit and
   Settings, and measured on /1pScribeFlow.html at 1400x900 and 390x844:
   - C43 the calendar showed a Booked / Arrived / Roomed / Completed colour
     legend while feat_mls_calbox_uniform.js paints every active appointment
     one blue - a key to colours the grid never uses;
   - C44 "Show more calendar tools" put "New appointment" + "+ New appointment"
     and "Pull plan" + "Pull plan" on screen at once;
   - C45 the calendar Refresh was named "Refresh - September 2026" while
     August 2026 was on screen;
   - C46 one server outage raised two red banners with two retry buttons
     ("Reading provider schedule failed - HTTP 503 . Retry" and
     "Appointments could not be loaded ... Try again");
   - C54 the Admin "Full name" input had no type, so it rendered as a bare
     164x22 box with a thick black border beside the styled Email field;
   - C55 Admin loads its cards itself, yet each still read "Press Refresh to
     load ..." after that load had failed, the failure only flashed past as one
     of four toasts, and the users table told the owner about
     "LEGAL_RELEASE_* values". A failed card now says why in its own words
     (an HTTP 5xx is "answered with an error", no answer at all is "did not
     answer") and names its one retry, the card's header button; a 401 that
     did not end the session still leaves the card saying the load failed.
   Real Chrome; nothing leaves 127.0.0.1 (the MLS server is stubbed, and
   answers 503 unless a step says otherwise). */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

/* The stubbed MLS server. `extra` holds the answers a step switches on. */
const USER = { id: 'harness', email: 'ui-harness@mlsscribe.test', role: 'doctor', name: 'Sample Provider, MD', premium: true, hasAccess: true, agreements: { required: false, signerComplete: true } };
const extra = [];
function answer(url) {
  const u = String(url);
  for (const [re, body] of extra) if (re.test(u)) return body;
  if (/\/api\/me(\?|$)/.test(u)) return { user: Object.assign({ access: 'premium' }, USER) };
  if (/\/api\/auth\/me\b/.test(u)) return { user: Object.assign({ totp_enabled: false }, USER) };
  if (/\/api\/auth\/2fa\/status/.test(u)) return { enabled: false };
  if (/\/api\/keys\b/.test(u)) return { keys: [] };
  if (/\/api\/health\b/.test(u)) return { ok: true };
  if (/\/api\/agreements\/me(\?|$)/.test(u)) return { signed: true, version: '2026-06-10' };
  if (/\/api\/prefs(\?|$)/.test(u)) return { prefs: {} };
  return null;
}

/* August 2026, weekdays, one status per row in turn. */
function augustRows() {
  const STATUS = ['booked', 'arrived', 'roomed', 'completed'];
  const rows = []; let id = 7000, n = 0;
  for (let d = 3; d <= 28; d++) {
    const dow = new Date(2026, 7, d).getDay(); if (dow === 0 || dow === 6) continue;
    for (let k = 0; k < 4; k++) {
      const key = '2026-08-' + String(d).padStart(2, '0'), hh = String(8 + k).padStart(2, '0');
      rows.push({ id: ++id, name: 'Test Patient' + n, appt_date: key, start_at: key + 'T' + hh + ':00:00', end_at: key + 'T' + hh + ':25:00',
        status: STATUS[n % 4], provider: 'Sample Provider, MD' });
      n++;
    }
  }
  return rows;
}

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
    const ctx = await b.newContext(ctxOpts);
    await ctx.addInitScript(() => { try { sessionStorage.setItem('sf_session', 'ui-harness@mlsscribe.test'); sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const a = answer(r.request().url());
      return a ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(a) }) : r.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate((user) => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
      try { bkUser = user; } catch (e) {}
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    }, USER);
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.evaluate(() => {
      window.__said = [];
      const t0 = window.toast;
      window.toast = function (m, k) { window.__said.push(String(m)); return t0 && t0.apply(this, arguments); };
    });
    /* a signed-in session raises its first-run questions over everything; answer them */
    for (let i = 0; i < 16; i++) {
      await pg.evaluate(() => {
        const bs = [...document.querySelectorAll('button')].filter((x) => x.offsetParent);
        const f = bs.find((x) => /Use faster day-only pulls/.test(x.textContent)); if (f) f.click();
        const m = bs.find((x) => /^No, it is mine$/.test(x.textContent.trim())); if (m) m.click();
        const l = bs.find((x) => /^Later$/.test(x.textContent.trim()) && /MLS Assist is not installed/.test(((x.parentElement && x.parentElement.parentElement) || x).textContent)); if (l) l.click();
      });
      await pg.waitForTimeout(250);
    }
    return pg;
  };

  /* what a doctor can see on the calendar right now */
  const CAL = () => {
    const V = window.__clunky.visible;
    const btns = [...document.querySelectorAll('button')].filter(V);
    const flat = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      banners: ['mlsT3Status', 'calLoadNotice'].filter((id) => V(document.getElementById(id))),
      retries: btns.filter((x) => /^(Retry|Try again)$/.test(flat(x)) && x.closest('#calendarView,#mlsT3Status')).length,
      newAppt: btns.filter((x) => /^\+?\s*New appointment$/i.test(flat(x))).length,
      pullPlan: btns.filter((x) => /^Pull plan$/i.test(flat(x))).length,
      legend: [...document.querySelectorAll('#calendarView *')].filter((e) => V(e) && /^Booked ?Arrived ?Roomed ?Completed$/.test(flat(e))).length
    };
  };
  const toggleTools = (pg) => pg.evaluate(() => { const x = document.getElementById('mlsCvMore_calendar'); if (x) x.click(); });

  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });

    /* ---- Calendar during an outage ---------------------------------- */
    await pg.evaluate(() => showView('calendar'));
    await pg.waitForFunction(() => !!document.getElementById('calLoadNotice'), null, { timeout: 30000 });
    await pg.waitForTimeout(3600);   /* past the status strip's own 3.2s repaint */
    const out = await pg.evaluate(CAL);
    /* C46 */
    assert.deepStrictEqual(out.banners, ['calLoadNotice'], 'one outage raises one banner - the calendar\'s own notice: ' + JSON.stringify(out));
    assert.strictEqual(out.retries, 1, 'one outage offers one retry: ' + JSON.stringify(out));
    /* C43 */
    assert.strictEqual(out.legend, 0, 'no Booked/Arrived/Roomed/Completed colour legend: ' + JSON.stringify(out));
    /* C44, tools closed: one door, and it books */
    assert.strictEqual(out.newAppt, 1, 'exactly one "New appointment" with the calendar tools closed: ' + JSON.stringify(out));

    /* C44, tools open */
    await toggleTools(pg);
    await pg.waitForTimeout(1500);
    const open = await pg.evaluate(CAL);
    assert.ok(await pg.evaluate(() => document.body.classList.contains('mls-cv-open-calendar')), 'the calendar tools opened');
    assert.strictEqual(open.newAppt, 1, 'exactly one "New appointment" with the calendar tools open: ' + JSON.stringify(open));
    assert.strictEqual(open.pullPlan, 1, 'exactly one "Pull plan" with the calendar tools open: ' + JSON.stringify(open));
    assert.strictEqual(open.legend, 0, 'no colour legend inside the calendar tools either');
    await toggleTools(pg);
    await pg.waitForTimeout(1500);
    const booked = await pg.evaluate(async () => {
      const x = [...document.querySelectorAll('button')].find((e) => window.__clunky.visible(e) && /^\+?\s*New appointment$/i.test(e.textContent.trim()));
      if (!x) return 'no New appointment on screen';
      x.click();
      await new Promise((r) => setTimeout(r, 1000));
      const box = document.getElementById('calNewApptBox');
      const ok = window.__clunky.visible(box);
      try { if (typeof calCloseNewAppt === 'function') calCloseNewAppt(); else box.style.display = 'none'; } catch (e) {}
      return ok;
    });
    assert.strictEqual(booked, true, 'the one "New appointment" opens the booking form: ' + booked);

    /* C45: the Refresh never names a month that is not on screen */
    const names = await pg.evaluate(async () => {
      const MON = /(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/;
      const pass = () => { try { document.body.appendChild(document.createElement('i')); window.__mlsCalmShell.render(); } catch (e) {} };
      pass(); await new Promise((r) => setTimeout(r, 400));
      calPrev(); await new Promise((r) => setTimeout(r, 1200));
      pass(); await new Promise((r) => setTimeout(r, 400));
      const shown = ((document.getElementById('calMonthLabel') || {}).textContent || '').trim();
      const refs = [...document.querySelectorAll('#calendarView button')].filter((x) => /Refresh/.test(x.textContent))
        .map((x) => x.getAttribute('aria-label') || x.textContent.trim());
      return { shown, refs, wrong: refs.filter((n) => MON.test(n) && n.match(MON)[0] !== shown) };
    });
    assert.ok(names.refs.length >= 1, 'the calendar has its Refresh: ' + JSON.stringify(names));
    assert.deepStrictEqual(names.wrong, [], 'no Refresh is named for a month other than the one on screen: ' + JSON.stringify(names));

    /* C46 (the other half) + C43 on a real month: the appointments come back,
       the provider list still fails - that failure is not the notice's, so it
       shows, once; and the chips show why a status legend would be false. */
    extra.push([/\/api\/appointments(\?|$)/, { appointments: augustRows(), me: {} }]);
    /* the uniform-box module is a deferred asset; measure the calendar it leaves */
    await pg.waitForFunction(() => !!(window._calStatusColor && window._calStatusColor.__mlsCbWrapped), null, { timeout: 60000 });
    await pg.evaluate(async () => { calJump('2026-08'); await loadCalendar(); });
    await pg.waitForTimeout(2000);
    const month = await pg.evaluate(CAL);
    const chips = await pg.evaluate(() => { const c = window.__clunky.calChips(); return { n: c.length, colours: [...new Set(c.map((e) => getComputedStyle(e).backgroundColor))], status: [...new Set((window._calAppts || []).map((a) => a.status))] }; });
    assert.strictEqual(month.banners.length, 1, 'a failure the calendar notice does not cover still shows, once: ' + JSON.stringify(month));
    assert.ok(chips.n > 20 && chips.status.length >= 4, 'August renders its seeded appointments in four statuses: ' + JSON.stringify(chips));
    assert.strictEqual(chips.colours.length, 1, 'every active appointment is one colour: ' + JSON.stringify(chips));
    assert.strictEqual(month.legend, 0, 'so no legend promises four: ' + JSON.stringify(month));

    /* C46, bounded: a calendar read counts as "still loading" for 15 s at most.
       loadCalendar can exit early and leave 'loading' set; a stale claim must
       not hide a real read failure from the status strip. */
    const own = await pg.evaluate(async () => {
      const said = () => { const e = document.getElementById('mlsT3Status'); return e && window.__clunky.visible(e) ? e.textContent : ''; };
      const keep = [window.__mlsCalendarLoadError, window.__mlsCalendarHydration, window.__mlsCalendarHydrationAt];
      window.__mlsCalendarLoadError = '';
      window.__mlsCalendarHydration = 'loading'; window.__mlsCalendarHydrationAt = Date.now();
      window.MLSStatus.set(2, 'err', 'HTTP 503'); await new Promise((r) => setTimeout(r, 250));
      const fresh = said();
      window.__mlsCalendarHydrationAt = Date.now() - 20000;
      window.MLSStatus.set(2, 'err', 'HTTP 503'); await new Promise((r) => setTimeout(r, 250));
      const stale = said();
      window.MLSStatus.set(2, 'ok');
      [window.__mlsCalendarLoadError, window.__mlsCalendarHydration, window.__mlsCalendarHydrationAt] = keep;
      return { fresh, stale };
    });
    assert.ok(!/Reading appointments for selected date failed/.test(own.fresh), 'while the calendar read is fresh, its failure is left to the calendar notice: ' + JSON.stringify(own));
    assert.ok(/Reading appointments for selected date failed/.test(own.stale), 'a "loading" state older than 15 s no longer hides the failure: ' + JSON.stringify(own));

    /* ---- Admin during an outage ------------------------------------- */
    const adm = await pg.evaluate(async () => {
      try { bkUser = Object.assign({}, bkUser, { isAdmin: true, role: 'owner' }); } catch (e) {}
      window.__said = [];
      showView('admin');
      await new Promise((r) => setTimeout(r, 3500));
      const box = (id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { h: Math.round(r.height), top: Math.round(r.top), bw: s.borderTopWidth, pad: s.paddingLeft }; };
      const lbl = (f) => Math.round(document.querySelector('label[for="' + f + '"]').getBoundingClientRect().top);
      const card = (id) => { const e = document.getElementById(id); const c = e.closest('.card'); return { text: e.textContent.replace(/\s+/g, ' ').trim(), buttons: e.querySelectorAll('button').length,
        header: [...c.querySelectorAll('h2 button')].filter((x) => window.__clunky.visible(x)).map((x) => x.textContent.replace(/[^A-Za-z ]/g, '').trim()) }; };
      return { name: box('adminCreateName'), email: box('adminCreateEmail'), lblName: lbl('adminCreateName'), lblEmail: lbl('adminCreateEmail'),
        cards: ['adminUsersEmpty', 'adminCodesEmpty', 'adminBackupsEmpty', 'adminAuditEmpty'].map(card), said: window.__said.slice() };
    });
    /* C54 */
    assert.ok(Math.abs(adm.name.h - adm.email.h) <= 2 && adm.name.bw === adm.email.bw && adm.name.pad === adm.email.pad,
      'the Full name field is styled like the Email field beside it: ' + JSON.stringify(adm));
    assert.ok(Math.abs(adm.lblName - adm.lblEmail) <= 2, 'the Full name and Email labels sit on one line: ' + JSON.stringify(adm));
    /* C55 */
    for (const c of adm.cards) {
      assert.ok(!/Press (Refresh|Load recent)[a-z ]* to (load|view)/.test(c.text), 'no card asks for a Refresh press to load what Admin already loaded: ' + c.text);
      assert.match(c.text, /^⚠️Could not load [a-z ]+: the MLS server answered with an error\. Press (Refresh users|Refresh codes|Refresh backups|Load recent) to try again\.$/, 'a failed load is said in its card, and a 503 is an answer: ' + c.text);
      const named = c.text.match(/Press (.+) to try again/)[1];
      assert.strictEqual(c.buttons, 0, 'no second retry button inside the card: ' + c.text);
      assert.deepStrictEqual(c.header, [named], 'the one retry is the card header button the sentence names: ' + JSON.stringify(c));
    }
    assert.deepStrictEqual(adm.said.filter((m) => /Could not load (users|codes|backups|audit)/.test(m)), [], 'the failures are in the cards, not four toasts: ' + JSON.stringify(adm.said));
    /* C55: what each kind of failure is called */
    const words = await pg.evaluate(() => {
      const say = (e, table) => { const b = document.createElement('div'); adminCardFailed(b, table || null, 'users', 'Refresh users', e); return b.textContent.replace(/\s+/g, ' ').trim(); };
      const err = (m, st) => { const e = new Error(m); if (st) e.status = st; return e; };
      const shownTable = document.createElement('table');
      return { e401: say(err('401')), net: say(new TypeError('Failed to fetch')), e500: say(err('Request failed (500).', 500)),
        e502msg: say(err('Upstream unavailable', 502)), fourxx: say(err('Choose at most 500 codes.', 400)), plain4xx: say(err('Request failed (403).', 403)),
        refresh: say(err('Request failed (503).', 503), shownTable) };
    });
    assert.strictEqual(words.e401, '⚠️Could not load users. Press Refresh users to try again.', 'a 401 that leaves the session signed in still says the load failed: ' + words.e401);
    assert.match(words.net, /: the MLS server did not answer\./, 'no response at all is "did not answer": ' + words.net);
    assert.match(words.e500, /: the MLS server answered with an error\./, 'a 500 is an answer, an error one: ' + words.e500);
    assert.match(words.e502msg, /: the MLS server answered with an error\./, 'any 5xx status is an error answer: ' + words.e502msg);
    assert.ok(/Choose at most 500 codes\./.test(words.fourxx) && !/did not answer|answered with an error/.test(words.fourxx), 'a 4xx message with a 5xx-looking number is not read as an outage: ' + words.fourxx);
    assert.match(words.plain4xx, /: the MLS server turned the request down\./, 'a bare 4xx is a refusal: ' + words.plain4xx);
    assert.match(words.refresh, /^⚠️Could not refresh users: .* The list below may be out of date\. Press Refresh users to try again\.$/, 'a failed refresh over a shown list says the list may be stale: ' + words.refresh);

    /* C55: Try again works, and the users table speaks plainly */
    extra.push([/\/api\/admin\/users(\?|$)/, { users: [
      { id: 1, email: 'owner@clinic.test', name: 'Owner', role: 'owner', isAdmin: true, access: 'comp', visits: 3 },
      { id: 2, email: 'dr.lee@clinic.test', name: 'Sam Lee, DO', role: 'doctor', access: 'trial', visits: 1 }] }]);
    extra.push([/\/api\/admin\/legal-release(\?|$)/, { releaseConfigured: false, grants: [] }]);
    const users = await pg.evaluate(async () => {
      const retry = [...document.querySelectorAll('#adminUsersEmpty')].map((e) => e.closest('.card').querySelector('h2 button')).find((x) => x && /Refresh users/.test(x.textContent));
      if (!retry) return null;
      retry.click();
      await new Promise((r) => setTimeout(r, 1500));
      const t = document.getElementById('adminUsersTable');
      return { table: window.__clunky.visible(t), empty: window.__clunky.visible(document.getElementById('adminUsersEmpty')), text: t.textContent.replace(/\s+/g, ' ') };
    });
    assert.ok(users && users.table && !users.empty, 'Refresh users loads the users: ' + JSON.stringify(users));
    assert.ok(/dr\.lee@clinic\.test/.test(users.text), 'the users are listed');
    assert.ok(!/LEGAL_RELEASE|\b[A-Z]{3,}_[A-Z_]{3,}\*?|backend/.test(users.text), 'no server setting names or backend talk in the users table: ' + users.text);
    assert.match(users.text, /legal release/i, 'the missing legal release is said in plain words');

    /* ---- Phone 390x844 ---------------------------------------------- */
    extra.length = 0;
    const ph = await boot(PHONE);
    await ph.evaluate(() => showView('calendar'));
    await ph.waitForFunction(() => !!document.getElementById('calLoadNotice'), null, { timeout: 30000 });
    await ph.waitForTimeout(3600);
    const pc = await ph.evaluate(CAL);
    assert.deepStrictEqual(pc.banners, ['calLoadNotice'], 'phone: one outage, one banner: ' + JSON.stringify(pc));
    assert.strictEqual(pc.legend, 0, 'phone: no colour legend');
    await toggleTools(ph);
    await ph.waitForTimeout(1500);
    const po = await ph.evaluate(CAL);
    assert.ok(po.newAppt <= 1 && po.pullPlan <= 1, 'phone: one "New appointment" and one "Pull plan" at most: ' + JSON.stringify(po));
    const pa = await ph.evaluate(async () => {
      try { bkUser = Object.assign({}, bkUser, { isAdmin: true, role: 'owner' }); } catch (e) {}
      showView('admin');
      await new Promise((r) => setTimeout(r, 3500));
      const n = document.getElementById('adminCreateName'), e = document.getElementById('adminCreateEmail');
      return { n: Math.round(n.getBoundingClientRect().height), e: Math.round(e.getBoundingClientRect().height), bw: getComputedStyle(n).borderTopWidth,
        users: document.getElementById('adminUsersEmpty').textContent.trim() };
    });
    assert.ok(Math.abs(pa.n - pa.e) <= 2 && pa.bw === '1px', 'phone: the Full name field is styled: ' + JSON.stringify(pa));
    assert.match(pa.users, /Could not load users/, 'phone: the users card says the load failed: ' + JSON.stringify(pa));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS calendar and admin say it once: one outage banner, one New appointment and one Pull plan, no colour legend for one-colour chips, a Refresh named for no stale month, a styled Full name field, and Admin cards that say they are loading or why they failed');
  } finally { await b.close(); srv.close(); }
});
