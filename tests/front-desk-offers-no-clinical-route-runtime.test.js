'use strict';
/* A front-desk login is offered the front desk and nothing clinical
   (stafffix-1.0.0, 2026-09-23). Found by the Staff hunt, in real Chrome with a
   receptionist session (bkUser.role='receptionist' through applyAccessUI, the
   app's real role path):
   - "Start unassigned visit" under the board opened the full visit workspace;
   - the dock's Review opened Orders (another module re-showed the relocated
     Orders tab the role gate had hidden), AI Studio opened Studio, and Tools
     listed Dictate, Prep op notes, Staff prep, Legal / IME and Export
     everything for EMR; Copilot was offered;
   - "More" re-showed Pre-visit link, Check intakes and "Remove
     Athena-imported patients (REMOVES DATA)";
   - on a phone the doctor's recording app covered the check-in board and
     offered "Start recording" (and once it stands down, the header's
     "+ New" must not offer New visit or New patient).
   The receptionist keeps Front desk, Messages, Communication, Settings and
   Calendar. A doctor keeps everything. Real Chrome; the API and AI are
   stubbed; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';

const DESK = { viewport: { width: 1400, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = fmt(new Date());
/* Clinical routes a front-desk account must never be offered. */
const CLINICAL = /dictate|assistant|op note|staff prep|legal|export|intake|template|widget|snapshot|verify saved|share|visit|athena|pull|practice|schedule|import|copilot/i;

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
});

/* The server a front-desk account talks to: the board and messages answer,
   every clinical route is refused. */
const api = (m, p) => {
  if (p === '/api/appointments' && m === 'GET') return { json: { appointments: [{ id: 1, name: 'Ann Frontdesk', status: 'booked', appt_date: TODAY, start_at: TODAY + 'T14:00:00Z' }], doctors: [{ id: 1, name: 'Dr One' }] } };
  if (p === '/api/messages') return { json: { messages: [], unread: 0 } };
  return { status: 403, json: { error: 'Clinician only' } };
};

srv.listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const u = new URL(r.request().url());
      const out = /scrivara-backend\.onrender\.com/.test(u.host) ? api(r.request().method(), u.pathname) : null;
      if (out) return r.fulfill({ status: out.status || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out.json) });
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
      window.__aiCalls = 0;
      window.aiCallRaw = async function () { window.__aiCalls++; throw new Error('AI is stubbed in this test'); };
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
  /* The app's real role path: bkUser, then applyAccessUI(). */
  const signInAs = (pg, role) => pg.evaluate(async (role) => {
    sessionStorage.setItem('sf_bk_token', 'harness-token');
    bkUser = role === 'receptionist'
      ? { email: 'desk@mlsscribe.test', name: 'Desk Person', role: 'receptionist', hasAccess: true, capabilities: { scheduling: true, patientCharts: false, analytics: false } }
      : { email: 'doc@mlsscribe.test', name: 'Doc Person', role: 'doctor', hasAccess: true, capabilities: {} };
    applyAccessUI();
    const ui = window.__mlsPhoneUI;
    const phoneRightAfter = !!(ui && ui.state && ui.state().mounted);
    await new Promise((r) => setTimeout(r, 800));
    return phoneRightAfter;
  }, role);
  /* Another module's re-apply pass is what re-showed the hidden Orders tab. */
  const settle = async (pg) => {
    await pg.evaluate(() => { try { if (window.__mlsHx && window.__mlsHx.installed && window.__mlsHx.reapply) window.__mlsHx.reapply(); } catch (e) {} });
    await pg.waitForTimeout(1500);
  };
  const screen = (pg) => pg.evaluate(() => {
    const V = window.__clunky.visible, $ = (id) => document.getElementById(id);
    try { renderProfile(); } catch (e) {} /* a later re-render must not bring anything back */
    return {
      view: window.__mlsCurrentView,
      dock: [...document.querySelectorAll('#mlsDock button[data-dest]')].filter(V).map((x) => x.getAttribute('data-dest')),
      copilot: V($('mlsDockCopilot')),
      unassigned: [...document.querySelectorAll('button')].some((x) => V(x) && /Start unassigned visit/.test(x.textContent)),
      board: V($('boardBox')),
      deskTabs: ['frontdesk', 'messages', 'comms', 'settings'].filter((t) => V($('rectab_' + t))),
      ordersRow: $('nav_orders') ? getComputedStyle($('nav_orders')).display : 'absent',
      studioTab: $('nav_studio') ? $('nav_studio').style.display : 'absent'
    };
  });
  const toolsRows = async (pg) => {
    await pg.locator('#mlsDock button[data-dest="tools"]').click();
    await pg.waitForTimeout(600);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('#mlsToolsMenu [role=menuitem]')].filter((x) => window.__clunky.visible(x)).map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(300);
    return rows;
  };
  const moreRows = async (pg) => {
    await pg.locator('#ptMoreBtn').click();
    await pg.waitForTimeout(500);
    const shown = await pg.evaluate(() => ['ptLinkBtn', 'ptIntakeBtn', 'ptPurgeAthenaBtn', 'ptBookLinkBtn', 'ptBoardBtn', 'ptAvailBtn'].filter((id) => window.__clunky.visible(document.getElementById(id))));
    await pg.locator('#ptMoreBtn').click();
    await pg.waitForTimeout(300);
    return shown;
  };
  try {
    /* ---------------- desktop, receptionist ---------------- */
    const pg = await boot(DESK);
    await signInAs(pg, 'receptionist');
    await settle(pg);
    const desk = await screen(pg);
    assert.strictEqual(desk.view, 'patients', 'a front-desk login lands on the front desk');
    assert.ok(desk.board, 'the check-in board is on screen');
    assert.deepStrictEqual(desk.deskTabs, ['frontdesk', 'messages', 'comms', 'settings'], 'Front desk, Messages, Communication and Settings stay');
    assert.deepStrictEqual(desk.dock, ['day', 'patient', 'tools'], 'the dock offers Calendar, the front desk and Tools, and no Visit, Review or AI Studio: ' + JSON.stringify(desk.dock));
    assert.strictEqual(desk.copilot, false, 'Copilot is not offered to a front-desk login');
    assert.strictEqual(desk.unassigned, false, '"Start unassigned visit" is not offered to a front-desk login');
    assert.strictEqual(desk.ordersRow, 'none', 'the relocated Orders tab stays hidden after another module re-applies its menu styling');
    assert.strictEqual(desk.studioTab, 'none', 'the AI Studio tab is hidden for a front-desk login');

    const tools = await toolsRows(pg);
    assert.ok(tools.some((t) => /log out/i.test(t)) && tools.some((t) => /^.?.?\s*settings$/i.test(t)), 'Tools still offers Settings and Log out: ' + JSON.stringify(tools));
    assert.deepStrictEqual(tools.filter((t) => CLINICAL.test(t)), [], 'Tools offers no clinical row to a front-desk login: ' + JSON.stringify(tools));

    /* no chart pull from Athena: not the door, not the function behind it;
       and the app's own redirect (sign-in lands on 'visit') says nothing */
    const pull = await pg.evaluate(async () => {
      const door = document.getElementById('mlsPullDoor');
      const doorShown = !!(door && window.__clunky.visible(door));
      const pulled = await pullPatientChartViaAssist(null, { name: 'Ada Sample' });
      /* sign-in's landing: session start sends a front-desk login to the front desk */
      const landing = /isReceptionistUser\(\)\) showView\('patients'\); else showView\('visit'\);/.test(String(startSession));
      return { doorShown, pulled, landing, view: window.__mlsCurrentView };
    });
    assert.strictEqual(pull.doorShown, false, 'the "type a name and date of birth" chart-pull door is not offered to the front desk');
    assert.strictEqual(pull.pulled, false, 'a chart pull is refused for a front-desk login');
    assert.strictEqual(pull.landing, true, 'sign-in lands a front-desk login on the front desk, so the route guard never greets it with an error');
    assert.strictEqual(pull.view, 'patients');

    const more = await moreRows(pg);
    assert.deepStrictEqual(more, ['ptBookLinkBtn', 'ptBoardBtn', 'ptAvailBtn'], '"More" keeps scheduling and never re-shows Pre-visit link, Check intakes or Remove Athena-imported patients: ' + JSON.stringify(more));

    /* Every clinical route lands back on the front desk, whoever calls it. */
    const routes = await pg.evaluate(async () => {
      const out = {};
      for (const v of ['visit', 'orders', 'recs', 'history', 'studio', 'analysis']) { try { showView(v); } catch (e) {} out[v] = window.__mlsCurrentView; }
      try { goNewUnassignedVisit(); } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
      out.unassigned = window.__mlsCurrentView;
      out.visitOnScreen = window.__clunky.visible(document.getElementById('visitView'));
      try { showView('calendar'); } catch (e) {}
      out.calendar = window.__mlsCurrentView;
      out.calendarOnScreen = window.__clunky.visible(document.getElementById('calendarView'));
      try { showView('patients'); } catch (e) {}
      return out;
    });
    assert.deepStrictEqual(routes, { visit: 'patients', orders: 'patients', recs: 'patients', history: 'patients', studio: 'patients', analysis: 'patients', unassigned: 'patients', visitOnScreen: false, calendar: 'calendar', calendarOnScreen: true },
      'clinical routes land on the front desk and the Calendar still opens: ' + JSON.stringify(routes));

    /* ---------------- same tab, a doctor signs in: nothing is lost ---------------- */
    await signInAs(pg, 'doctor');
    await settle(pg);
    const doc = await screen(pg);
    assert.ok(['visit', 'review', 'studio', 'tools'].every((d) => doc.dock.includes(d)), 'a doctor keeps Visit, Review, AI Studio and Tools: ' + JSON.stringify(doc.dock));
    assert.strictEqual(doc.copilot, true, 'a doctor keeps Copilot');
    await pg.evaluate(() => { try { showView('patients'); setActivePtId(''); renderProfile(); } catch (e) {} });
    assert.strictEqual((await screen(pg)).unassigned, true, 'a doctor keeps "Start unassigned visit"');
    assert.notStrictEqual(doc.ordersRow, 'none', 'a doctor keeps the Orders tab');
    const docTools = await toolsRows(pg);
    assert.ok(['Dictate', 'Prep op notes', 'Log out'].every((n) => docTools.some((t) => t.includes(n))), 'a doctor keeps the clinical Tools rows: ' + JSON.stringify(docTools));
    const docMore = await moreRows(pg);
    assert.ok(['ptLinkBtn', 'ptIntakeBtn', 'ptPurgeAthenaBtn'].every((id) => docMore.includes(id)), 'a doctor keeps every "More" row: ' + JSON.stringify(docMore));
    assert.strictEqual(await pg.evaluate(() => { showView('visit'); return window.__mlsCurrentView; }), 'visit', 'a doctor opens the Visit screen');

    /* ---------------- phone ---------------- */
    const ph = await boot(PHONE);
    await signInAs(ph, 'doctor');
    await ph.waitForTimeout(1500);
    assert.strictEqual(await ph.evaluate(() => !!(window.__mlsPhoneUI && window.__mlsPhoneUI.state().mounted)), true, 'a doctor on a phone gets the phone app');
    const mountedAfterSwitch = await signInAs(ph, 'receptionist');
    assert.strictEqual(mountedAfterSwitch, false, 'the phone app stands down as soon as the front-desk role is applied');
    await ph.evaluate((d) => { window._calAppts = [{ id: 1, name: 'Ann Frontdesk', status: 'booked', appt_date: d, start_at: d + 'T14:00:00Z' }]; try { window.dispatchEvent(new Event('mls:calendar-hydrated')); } catch (e) {} }, TODAY);
    await ph.waitForTimeout(2500);
    const phone = await ph.evaluate(() => {
      const V = window.__clunky.visible, bb = document.getElementById('boardBox');
      const r = bb.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(r.x + 20, 380), Math.max(5, Math.min(r.y + 20, 800)));
      return {
        mounted: !!(window.__mlsPhoneUI && window.__mlsPhoneUI.state().mounted),
        shell: V(document.getElementById('mlsPh3')),
        view: window.__mlsCurrentView,
        board: V(bb),
        boardHit: !!(hit && bb.contains(hit)),
        recording: [...document.querySelectorAll('button')].some((x) => V(x) && /start recording/i.test(x.textContent))
      };
    });
    assert.deepStrictEqual(phone, { mounted: false, shell: false, view: 'patients', board: true, boardHit: true, recording: false },
      'on a phone a front-desk login stays on the front desk, the board is not covered, and recording is not offered: ' + JSON.stringify(phone));
    /* The phone header's "+ New" is the one button up there. */
    await ph.locator('#mlsRdNewBtn').click();
    await ph.waitForTimeout(400);
    const newRows = await ph.evaluate(() => [...document.querySelectorAll('#mlsRdNewMenu [role=menuitem]')].filter((x) => window.__clunky.visible(x)).map((x) => x.textContent.trim()));
    assert.deepStrictEqual(newRows, ['New appointment'], '"+ New" offers a front-desk login New appointment only: ' + JSON.stringify(newRows));

    assert.strictEqual(await pg.evaluate(() => window.__aiCalls), 0, 'no AI call was made');
    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS front desk offers no clinical route: the dock, Tools, More, the unassigned visit and every clinical view are closed to a front-desk login on desktop and phone, and a doctor keeps all of them');
  } finally { await b.close(); srv.close(); }
});
