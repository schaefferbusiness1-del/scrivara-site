'use strict';

/* /1p CLUNKY CONTRACT
 *
 * The 2026-08-17/18 clunky audit found 148 skeptic-confirmed defects in the
 * /1p lane. This suite pins the ones this lane fixed, as properties a machine
 * can check, so they cannot come back quietly.
 *
 * Each assertion names the audit item number it guards. PART 1 is static over
 * both twins. PART 2 drives the real shell in real headless Chrome with a
 * synthetic 28-patient day - no login, no network, no PHI.
 *
 * THE TRAP THIS SUITE SHARES WITH 1p-ui-shape-contract: 1p-mls-connect.js and
 * its 219 feature modules are NOT loaded by the page on its own. A measurement
 * taken without window.__mlsEnsureUiBundle() measures a bare shell and reports
 * that everything is fine.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* Every block this suite owns. Adding one here makes it carry the same
   existence + lane-neutrality checks as its neighbours. */
const BLOCKS = [
  'clunky-header-1.0.0',
  'clunky-settings-1.0.0',
  'clunky-staffprep-1.0.0',
  'clunky-dock-1.0.0',
  'clunky-notice-1.0.0',
  'clunky-athena-1.0.0',
  'clunky-calendar-1.0.0',
  /* clunky2 lane (2026-08-18): the rooms the first lane did not reach. */
  'clunky2-rooms-1.0.0',
  'clunky2-visitnote-1.0.0',
  /* caldata lane (2026-08-18): the calendar items 33-38 the first two lanes
     reported as unreachable. */
  'caldata-1.0.0'
];

/* ============================================================ PART 1: static */

for (const name of SHELLS) {
  const src = read(name);
  for (const block of BLOCKS) {
    const open = '<!-- ===== ' + block + ' ';
    const close = '<!-- ===== end ' + block;
    eq(src.split(open).length - 1, 1, `${name}: ${block} must open exactly once`);
    eq(src.split(close).length - 1, 1, `${name}: ${block} must close exactly once`);
    ok(src.indexOf(open) < src.indexOf(close), `${name}: ${block} closes before it opens`);

    /* LANE NEUTRALITY - a block that names this lane cannot be promoted to
       /cloned or production by copying it. Checked over the block's own span. */
    const span = src.slice(src.indexOf(open), src.indexOf(close));
    ok(!/__MLS_P1_PREVIEW/.test(span), `${name}: ${block} references __MLS_P1_PREVIEW and cannot be promoted`);
    ok(!/\b1p-[\w.-]*\.js\b/.test(span), `${name}: ${block} references a 1p-prefixed file and cannot be promoted`);
    ok(!/1pScribeFlow\.html/.test(span), `${name}: ${block} references the 1p shell by name`);
    ok(!/['"]\/1p\//.test(span), `${name}: ${block} references the /1p route`);

    /* THE BACKSLASH TRAP (shell-transport-eats-backslashes). Four shipped /1p
       regexes lost their escapes in transport and the gate stayed green
       because nothing executed them. A bare `d+` / `s+` / `w+` inside a
       regex literal is that defect's fingerprint. */
    const bare = span.match(/\/\^?[^/\n*][^/\n]*\/[gimsuy]*/g) || [];
    for (const lit of bare) {
      ok(!/[^\\[]d\{\d/.test(lit), `${name}: ${block} has a regex with a bare d{n} - a backslash was eaten in transport: ${lit}`);
    }
  }
}

/* ============================================================ PART 2: runtime */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected into the page. Synthetic names only. */
function harness() {
  var NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample', 'Gus Sample',
    'Hal Sample', 'Ivy Sample', 'Jo Sample', 'Kit Sample', 'Lu Sample', 'Max Sample', 'Nia Sample', 'Oz Sample',
    'Pia Sample', 'Quin Sample', 'Rae Sample', 'Sid Sample', 'Tex Sample', 'Uma Sample', 'Val Sample',
    'Wes Sample', 'Xan Sample', 'Yas Sample', 'Zed Sample', 'Ann Sample', 'Ben Sample'];
  var PROCS = ['Lumbar medial branch block', 'Right L4-L5 transforaminal epidural steroid injection',
    'Radiofrequency ablation, lumbar facet', 'Sacroiliac joint injection'];
  var DAY = '2026-08-17';

  /* THE INSTRUMENT LIES FIRST. Chrome keeps layout boxes for the subtree of a
     CLOSED <details> - its ::details-content is content-visibility:hidden - so
     a rect-only visibility test reports folded-away cards as visible. It
     called two provably closed folds open during this work. Anything inside a
     closed <details> is not on the doctor's screen, and is excluded here. */
  function inClosedDetails(el) {
    for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
      var par = p.parentElement;
      if (par && par.tagName === 'DETAILS' && !par.open && p.tagName !== 'SUMMARY') return true;
    }
    return false;
  }
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return !inClosedDetails(el);
  }
  function rect(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  window.__clunky = {
    visible: visible,
    rect: function (s) { return rect(document.querySelector(s)); },
    shown: function (s) { return visible(document.querySelector(s)); },
    /* What actually receives a click at the centre and the four corners. */
    coveredBy: function (sel) {
      var el = document.querySelector(sel);
      if (!el) return null;
      var r = el.getBoundingClientRect();
      var pts = [[r.x + r.width / 2, r.y + r.height / 2], [r.x + 2, r.y + 2],
        [r.right - 2, r.y + 2], [r.x + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
      return pts.map(function (p) {
        var t = document.elementFromPoint(p[0], p[1]);
        if (!t) return 'null';
        if (t === el || el.contains(t)) return 'self';
        return (t.id ? '#' + t.id : t.tagName + '.' + String(t.className || '').split(' ')[0]);
      });
    },
    overlap: function (a, b) {
      var A = document.querySelector(a), B = document.querySelector(b);
      if (!A || !B || !visible(A) || !visible(B)) return null;
      var x = A.getBoundingClientRect(), y = B.getBoundingClientRect();
      var w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
      var h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
      return (w > 1 && h > 1) ? { w: Math.round(w), h: Math.round(h) } : null;
    },
    ctrls: function (sel) {
      var host = sel ? document.querySelector(sel) : document.body;
      if (!host) return [];
      var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]';
      return Array.prototype.slice.call(host.querySelectorAll(CTRL)).filter(visible)
        .map(function (e) { return e.id || (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30) || e.tagName; });
    },
    busy: function (sel) {
      var host = sel ? document.querySelector(sel) : document.body;
      if (!host) return null;
      var blocks = 0, chars = 0;
      Array.prototype.slice.call(host.querySelectorAll('*')).forEach(function (e) {
        if (!visible(e)) return;
        var own = '';
        Array.prototype.slice.call(e.childNodes).forEach(function (n) { if (n.nodeType === 3) own += n.nodeValue; });
        own = own.trim();
        if (own) { blocks++; chars += own.length; }
      });
      return { ctrls: window.__clunky.ctrls(sel).length, blocks: blocks, chars: chars };
    },
    text: function (sel) {
      var h = document.querySelector(sel);
      return h ? (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim() : '';
    },
    seed: function () {
      var out = {};
      try {
        setTemplates(PROCS.map(function (p, i) {
          return { id: 'syn-t' + i, name: p, body: 'PROCEDURE: ' + p, kind: 'op' };
        }));
        localStorage.setItem(uns('useTemplates'), '1');
      } catch (e) { out.tplErr = String(e && e.message); }
      try {
        savePatients(NAMES.map(function (n, i) {
          return { id: 'syn-' + i, name: n, dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
            mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: [] };
        }));
        out.patients = getPatients().length;
      } catch (e) { out.ptErr = String(e && e.message); }
      window._calAppts = NAMES.map(function (n, i) {
        return { id: 'appt-' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
          start_at: DAY + 'T0' + (8 + (i % 8)) + ':00:00', reason: PROCS[i % PROCS.length],
          providerName: 'Sample Provider, MD' };
      });
      out.appts = window._calAppts.length;
      try { renderPatients(); } catch (e) {}
      return out;
    },
    nav: function (id) { try { var b = document.getElementById(id); if (b) b.click(); } catch (e) {} },

    /* ===== caldata-1.0.0: THE CALENDAR GRID'S REAL DATA SOURCE ==========
       Two lanes reported CLUNKY 33-38 unreachable because "seeding
       window._calAppts and calling renderCalendar() rendered 0 chips". That
       is not what happens. `_calAppts` is declared with `var` at the top level
       of the shell's single inline script, so it IS window._calAppts and
       renderCalendar() reads it directly. Two other things defeat a naive
       seed, and both are avoided here:

         1. Opening the calendar calls loadCalendar(), and on a signed-out
            HOSTED session (which the harness is - backendMode() is true over
            http and bkToken() is empty) it writes "Sign in to see the
            calendar." into #calGrid and RETURNS before rendering. So a seed
            applied before navigating is overwritten on screen. Give it a
            token and answer /api/appointments and it takes the normal path -
            `_calAppts = d.appointments` - which is the authoritative source.
         2. Twenty-eight appointments on ONE day are five chips and a
            "+23 more", not twenty-eight. A month must be SPREAD to be
            measurable.

       This seeds six appointments on every weekday of August 2026 through
       loadCalendar()'s own path, so what is measured afterwards is what a
       real signed-in calendar renders. */
    seedCalendarMonth: function () {
      var FIRST = ['Ada', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu', 'Max',
        'Nia', 'Oz', 'Pia', 'Quin', 'Rae', 'Sid', 'Tex', 'Uma', 'Val', 'Wes', 'Xan', 'Yas', 'Zed', 'Ann', 'Ben'];
      var LAST = ['Sample', 'Synthetic', 'Placeholder', 'Testcase'];
      var STATUS = ['booked', 'arrived', 'roomed', 'completed'];
      var rows = [], id = 9000, n = 0;
      for (var d = 1; d <= 31; d++) {
        var dow = new Date(2026, 7, d).getDay();
        if (dow === 0 || dow === 6) continue;
        for (var k = 0; k < 6; k++) {
          var hh = 8 + k, half = (n % 2) ? '30' : '00';
          var key = '2026-08-' + (d < 10 ? '0' + d : String(d));
          var hs = (hh < 10 ? '0' + hh : String(hh));
          rows.push({ id: ++id,
            name: FIRST[n % FIRST.length] + ' ' + LAST[Math.floor(n / FIRST.length) % LAST.length],
            patient_external_id: String(900000 + (n % 60)),
            appt_date: key, start_at: key + 'T' + hs + ':' + half + ':00',
            end_at: key + 'T' + hs + ':' + (half === '30' ? '55' : '25') + ':00',
            reason: PROCS[n % PROCS.length], status: STATUS[n % STATUS.length],
            provider: 'Sample Provider, MD', room: 'R' + (n % 4) });
          n++;
        }
      }
      try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
      if (!window.__clunkyCalFetch) {
        var of = window.fetch.bind(window);
        window.fetch = function (u, o) {
          var s = String((u && u.url) || u || '');
          if (/\/api\/appointments(\?|$)/.test(s)) {
            return Promise.resolve(new Response(JSON.stringify({ appointments: window.__clunkyCalRows, me: {} }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          if (/\/api\/providers/.test(s)) {
            return Promise.resolve(new Response(JSON.stringify({ providers: [] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return of(u, o);
        };
        window.__clunkyCalFetch = true;
      }
      window.__clunkyCalRows = rows;
      window._calMode = 'month'; window._calYear = 2026; window._calMonth = 7;
      window._calRefDate = '2026-08-17';
      var g = document.getElementById('calGrid'); if (g) { try { g._mlsSig = null; } catch (e) {} }
      return window.loadCalendar().then(function (r) {
        return { applied: !!(r && r.applied), count: r ? r.count : 0, rows: rows.length };
      });
    },
    /* Every appointment chip the three grids draw. Month and day use
       calApptPeek, week uses calChipOpen, day and week also carry data-appt -
       so the three selectors overlap and the list must be de-duplicated. */
    calChips: function () {
      var g = document.getElementById('calGrid'); if (!g) return [];
      var set = [];
      var push = function (n) { if (set.indexOf(n) < 0) set.push(n); };
      Array.prototype.slice.call(g.querySelectorAll('[data-appt]')).forEach(push);
      Array.prototype.slice.call(g.querySelectorAll('[onclick]')).forEach(function (n) {
        var oc = n.getAttribute('onclick') || '';
        if (/calApptPeek\(|calChipOpen\(/.test(oc)) push(n);
      });
      return set.filter(visible);
    },
    calClipped: function () {
      return window.__clunky.calChips().filter(function (c) { return c.scrollWidth > c.clientWidth + 1; }).length;
    }
  };
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
  });
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test'; });
  /* THE DOCK IS NOT THERE UNLESS THE CALM SHELL IS MADE TO LOAD. Its loader
     schedules feat_mls_calm_shell.js through window.__mlsDeferAsset ||
     requestIdleCallback, and requestIdleCallback - like rAF - never fires in
     a non-compositing tab, so #mlsDock, #mlsRightNow and the Tools menu are
     simply absent and every dock assertion would pass vacuously. boot() also
     refuses while #appScreen is display:none, which it is until the line
     above. Both are handled here, in this order. */
  await page.evaluate(() => {
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
  });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {}
  });
  await page.waitForTimeout(1500);
  await page.evaluate(harness);
  const seeded = await page.evaluate(() => window.__clunky.seed());
  eq(seeded.patients, 28, 'the synthetic roster did not land');
  eq(seeded.appts, 28, 'the synthetic day did not land');
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];

  try {
    /* ---------------------------------------------------------- 1366x900 */
    let page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(page, port);

    /* == CLUNKY 6 / 20 / 107: the mode chip and the date chip are reachable ==
     * MEASURED at HEAD: #mslChip was position:fixed z-index 941 at (1247,62)
     * under #appHeader (sticky, z 6000, 87px tall); elementFromPoint at the
     * centre of #mslChipBtn returned #appHeader on all four screens, so the
     * Simple/Normal/Everything switch could not be clicked anywhere. */
    for (const nav of ['nav_patients', 'nav_visit', 'nav_calendar', 'nav_studio']) {
      await page.evaluate((n) => window.__clunky.nav(n), nav);
      await page.waitForTimeout(600);
      const seen = await page.evaluate(() => ({
        chip: window.__clunky.rect('#mslChip'),
        hit: window.__clunky.coveredBy('#mslChipBtn'),
        inHeader: !!(document.getElementById('mslChip') && document.getElementById('mslChip').closest('#appHeader')),
        todayInHeader: !!(document.getElementById('mslToday') && document.getElementById('mslToday').closest('#appHeader'))
      }));
      measured['chip@' + nav] = seen.chip;
      eq(seen.hit && seen.hit[0], 'self',
        `${nav}: the mode chip is covered by ${seen.hit && seen.hit[0]} - the doctor cannot press it (CLUNKY 6)`);
      ok(seen.inHeader, `${nav}: #mslChip is not inside #appHeader, so it is floating again (CLUNKY 6)`);
      ok(seen.todayInHeader, `${nav}: #mslToday is not inside #appHeader, so it is floating again (CLUNKY 107)`);
    }

    /* == CLUNKY 55: the mode menu is a vertical list, not a screen-wide strip.
     * MEASURED at HEAD: 874px wide at 1280 because dock-1p-1.1.0 appends
     * #dockChipRows as a plain DIV into a column-flex menu and its five
     * inline-block buttons lay out in one row. */
    const menu = await page.evaluate(async () => {
      const b = document.getElementById('mslChipBtn'); if (b) b.click();
      await new Promise((r) => setTimeout(r, 300));
      const m = document.getElementById('mslChipMenu');
      const r = m ? m.getBoundingClientRect() : null;
      const rows = document.getElementById('dockChipRows');
      const dir = rows ? getComputedStyle(rows).flexDirection : 'column';
      if (b) b.click();
      return { w: r ? Math.round(r.width) : 0, right: r ? Math.round(r.right) : 0, dir: dir };
    });
    measured.chipMenu = menu;
    ok(menu.w > 0 && menu.w <= 300, `the mode menu is ${menu.w}px wide - it is a strip across the screen again (CLUNKY 55)`);
    eq(menu.dir, 'column', 'the taskbar rows inside the mode menu are laid out in one horizontal line again (CLUNKY 55)');

    /* == CLUNKY 83: nothing floats over the sign-in card. == */
    const signin = await page.evaluate(async () => {
      const a = document.getElementById('authScreen'), s = document.getElementById('appScreen');
      if (a) a.style.display = ''; if (s) s.style.display = 'none';
      await new Promise((r) => setTimeout(r, 500));
      const out = { chip: window.__clunky.shown('#mslChip'), today: window.__clunky.shown('#mslToday') };
      if (a) a.style.display = 'none'; if (s) s.style.display = '';
      return out;
    });
    ok(!signin.chip, 'the mode chip is on screen before sign-in (CLUNKY 83)');
    ok(!signin.today, 'the date chip is on screen before sign-in (CLUNKY 83)');

    /* ===================================================== SETTINGS ===== */
    const set = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      try { openSettings(); } catch (e) {}
      await sleep(1600);
      const out = { titles: 0, foot: {}, railHead: C.shown('.mls-set-rail-head') };
      /* 135: one "⚙️ Settings" on screen, not two. */
      Array.prototype.slice.call(document.querySelectorAll('#settingsModal h3, #settingsModal .mls-set-rail-head'))
        .forEach(function (n) { if (C.visible(n) && /Settings/.test(n.textContent || '')) out.titles++; });

      const tabs = Array.prototype.slice.call(document.querySelectorAll('#settingsTabBar .set-tab'));
      out.tabCount = tabs.length;
      /* 136: one footer shape on every tab. */
      for (let i = 0; i < tabs.length; i++) {
        tabs[i].click();
        await sleep(420);
        const row = document.querySelector('#settingsModal .modal > .row');
        const btns = row ? Array.prototype.slice.call(row.querySelectorAll('button')).filter(C.visible)
          .map(function (b) { return (b.textContent || '').trim(); }) : [];
        out.foot[(tabs[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16)] = btns.join('|');
      }
      /* 76 / 79 / 80: the vendor cards are behind ONE closed disclosure. */
      for (const t of tabs) { if (/Integrations/.test(t.textContent || '')) { t.click(); break; } }
      await sleep(1100);
      const fold = document.getElementById('mlsClunkySetVendor');
      out.fold = fold ? {
        open: fold.open,
        holds: ['athApiSettingsCard', 'schedApiCard'].filter(function (id) {
          const c = document.getElementById(id);
          return !!(c && c.closest('#mlsClunkySetVendor'));
        })
      } : null;
      /* innerText, not a rect: a closed <details> keeps boxes for its
         subtree in Chrome, so a rect-based visibility helper calls hidden
         vendor cards visible. Rendered text is the honest reading. */
      const sect = Array.prototype.slice.call(document.querySelectorAll('#settingsModal .set-section')).filter(C.visible);
      const shown = sect.map(function (s) { return s.innerText || ''; }).join(' ');
      out.jargonOnScreen = ['_lastUpdated', 'idempotent', 'redirect URI', 'refresh tokens']
        .filter(function (k) { return shown.indexOf(k) >= 0; });
      /* 77: one download control for one file. */
      out.downloads = Array.prototype.slice.call(document.querySelectorAll('#settingsModal button, #settingsModal a[href]'))
        .filter(C.visible)
        .filter(function (e) { return /download mls assist|direct package/i.test(e.textContent || ''); })
        .map(function (e) { return (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40); });
      out.words = shown.trim().split(/\s+/).length;
      out.scrollH = (function () { const m = document.querySelector('#settingsModal .modal'); return m ? m.scrollHeight : 0; })();

      /* 137: scrolled, the round × must not land inside the search input. */
      const modal = document.querySelector('#settingsModal .modal');
      if (modal) modal.scrollTop = 320;
      await sleep(350);
      out.xInSearch = C.overlap('#settingsModal .modal-x', '#settingsSearch');

      /* 75: the two "where navigation lives" dropdowns have different names. */
      for (const t of tabs) { if (/Display/.test(t.textContent || '')) { t.click(); break; } }
      await sleep(500);
      out.dockLabel = (function () {
        const s = document.getElementById('qolDockSide');
        const f = s && s.closest ? s.closest('.field') : null;
        const l = f ? f.querySelector('label') : null;
        return l ? (l.textContent || '').trim() : null;
      })();
      /* 131: the shared-computer field agrees with its own dropdown. */
      for (const t of tabs) { if (/Account/.test(t.textContent || '')) { t.click(); break; } }
      await sleep(500);
      out.shared = (function () {
        const cb = document.getElementById('swSharedToggle');
        const note = document.getElementById('swSharedNote');
        const sel = document.getElementById('idleMins');
        const on = typeof swEnabled === 'function' ? swEnabled() : null;
        const noteNum = note ? ((note.textContent || '').match(/after (\d+) quiet/) || [])[1] || null : null;
        return { on: on, checked: cb ? cb.checked : null, noteNum: noteNum, sel: sel ? sel.value : null,
          noteSaysOn: note ? /^On:/.test((note.textContent || '').trim()) : null };
      })();
      /* 74: only ONE place in the dialog claims a live connection. */
      out.connectedClaims = [];
      for (const t of tabs) {
        t.click(); await sleep(320);
        const s2 = Array.prototype.slice.call(document.querySelectorAll('#settingsModal .set-section')).filter(C.visible)
          .map(function (x) { return x.innerText || ''; }).join(' ');
        if (/Connected to your clinic's MLS server/i.test(s2)) out.connectedClaims.push('account-notice');
      }
      /* 132: Google Business is in exactly one tab. */
      out.gbpTabs = 0;
      for (const t of tabs) {
        t.click(); await sleep(300);
        const s3 = Array.prototype.slice.call(document.querySelectorAll('#settingsModal .set-section')).filter(C.visible)
          .map(function (x) { return x.innerText || ''; }).join(' ');
        if (/Google Business/i.test(s3)) out.gbpTabs++;
      }
      try { closeSettings(); } catch (e) {}
      return out;
    });
    measured.settings = {
      titles: set.titles, downloads: set.downloads, words: set.words, scrollH: set.scrollH,
      fold: set.fold, shared: set.shared, gbpTabs: set.gbpTabs, jargon: set.jargonOnScreen
    };
    eq(set.titles, 1, `"Settings" is written ${set.titles} times at the top of its own dialog (CLUNKY 135)`);
    const shapes = Object.keys(set.foot).map((k) => set.foot[k]);
    eq(new Set(shapes).size, 1,
      `the Settings footer changes shape by tab: ${JSON.stringify(set.foot)} (CLUNKY 136)`);
    ok(shapes[0] && shapes[0].indexOf('Save changes') >= 0 && shapes[0].indexOf('Cancel') >= 0,
      `the one footer is "${shapes[0]}" - Save and Cancel must both survive (CLUNKY 136)`);
    ok(set.fold && set.fold.open === false, 'the vendor cards are not behind a closed disclosure (CLUNKY 76)');
    eq(set.fold && set.fold.holds.length, 2,
      'the Athena API and Scheduling API cards are not both inside the vendor fold (CLUNKY 79, 80)');
    eq(set.jargonOnScreen.length, 0,
      `vendor documentation is still in the open on Integrations: ${set.jargonOnScreen.join(', ')} (CLUNKY 79, 80)`);
    eq(set.downloads.length, 1,
      `Integrations offers ${set.downloads.length} controls to download one file: ${set.downloads.join(' / ')} (CLUNKY 77)`);
    eq(set.xInSearch, null, 'scrolled, the round × sits inside the settings search box (CLUNKY 137)');
    ok(set.dockLabel && set.dockLabel !== 'Navigation bar',
      `the taskbar dropdown is still called "${set.dockLabel}", the same thing as "Navigation layout" (CLUNKY 75)`);
    ok(set.shared && set.shared.checked === set.shared.on,
      `the shared-computer switch shows ${set.shared && set.shared.checked} while the feature is ${set.shared && set.shared.on} (CLUNKY 131)`);
    ok(!set.shared.noteSaysOn || String(set.shared.noteNum) === String(set.shared.sel),
      `the shared-computer note says ${set.shared.noteNum} minutes while the dropdown says ${set.shared.sel} (CLUNKY 131)`);
    eq(set.connectedClaims.length, 0,
      'the Account tab still claims a live connection that the Advanced tab denies (CLUNKY 74)');
    ok(set.gbpTabs <= 1, `Google Business is configured in ${set.gbpTabs} different tabs (CLUNKY 132)`);

    /* ==================================================== STAFF PREP ===== */
    const staff = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      C.nav('nav_visit');
      await sleep(1000);
      window.dispatchEvent(new CustomEvent('mls:menu-staff-prep-request',
        { detail: { source: 'mls-topbar-menu', requestId: 'clunky-contract' } }));
      await sleep(2500);
      const vis = (n) => n && C.visible(n);
      const out = {};
      out.onStaff = !!document.querySelector('.ez3-pull');
      /* 11: exactly ONE primary control per job state. At idle that is Start
         (plus the separate "Pull today only"); Resume/Pause/Retry/Cancel must
         all be hidden, and the tint stylesheet's display:inline-flex
         !important must not be able to force them back. */
      out.row2 = Array.prototype.slice.call(document.querySelectorAll('.ez3-pull .ez3-row2 button'))
        .filter(vis).map((b) => b.id || (b.textContent || '').trim().slice(0, 22));
      /* 84: how many ways to pull are on one screen. */
      out.pulls = Array.prototype.slice.call(document.querySelectorAll('#mlsEz3 button, #mlsEz3 a[href]'))
        .filter(vis).filter((b) => /\bpull\b/i.test(b.textContent || ''))
        .map((b) => b.id || (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26));
      /* 88: an empty log is not a grey slab. */
      const lg = document.getElementById('ez3PullLog');
      out.logShown = vis(lg);
      out.logText = lg ? (lg.textContent || '').trim() : '';
      /* 89: unselected range tabs are not pale enough to read as disabled. */
      out.segColors = Array.prototype.slice.call(document.querySelectorAll('#ez3Seg button'))
        .filter(vis).filter((b) => !b.classList.contains('on'))
        .map((b) => getComputedStyle(b).color);
      /* 141: the doctor's step rail is not above a front-desk screen. */
      out.stages = vis(document.getElementById('mlsStages'));
      out.title = (function () { const t = document.getElementById('mlsRdTitle'); return t ? (t.textContent || '').trim() : ''; })();
      /* 86 / 87: no instruction that points at a control that is not there. */
      const all = (document.getElementById('mlsEz3') || document).innerText || '';
      out.deadPointers = ['Choose a provider in Staff Prep first', 'guards on', 'schedule parse timeout',
        'The provider reader could not establish an account-owned request']
        .filter((k) => all.indexOf(k) >= 0);
      out.busy = C.busy('#mlsEz3');
      /* 12: the status line is derived from the job manifest, not frozen. */
      out.statusOwner = !!(window.__mlsClunkyStaff && window.__mlsClunkyStaff.passes() > 0);
      return out;
    });
    measured.staffprep = { row2: staff.row2, pulls: staff.pulls, busy: staff.busy, title: staff.title };
    ok(staff.onStaff, 'the Staff Prep pull card did not render, so nothing below was measured');
    ok(staff.row2.length <= 2,
      `Staff Prep shows ${staff.row2.length} job buttons at idle (${staff.row2.join(', ')}) - the doctor cannot tell which to press (CLUNKY 11)`);
    ok(staff.row2.indexOf('ez3PullStart') >= 0, 'Staff Prep lost its Start control at idle (CLUNKY 11)');
    ok(staff.pulls.length <= 4,
      `${staff.pulls.length} ways to pull on one screen: ${staff.pulls.join(', ')} (CLUNKY 84)`);
    ok(!staff.logShown || staff.logText.length > 0,
      'the pull log is an empty grey slab in the middle of the card (CLUNKY 88)');
    for (const c of staff.segColors) {
      ok(c !== 'rgb(220, 231, 251)',
        `an unselected range tab computes ${c} - pale enough to read as disabled when it is not (CLUNKY 89)`);
    }
    ok(!staff.stages, 'the doctor Prep-Record-Review-Sign-Send rail is showing above the front-desk screen (CLUNKY 141)');
    eq(staff.title, 'Staff prep', `the header says "${staff.title}" while Staff Prep is on screen (CLUNKY 141)`);
    eq(staff.deadPointers.length, 0,
      `Staff Prep still says: ${staff.deadPointers.join(' | ')} (CLUNKY 85, 86, 87)`);
    ok(staff.statusOwner, 'the staff-prep status line has no owner, so it cannot follow the job (CLUNKY 12)');

    /* ============================================ DOCK, TOOLS, NOTICES === */
    const dock = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      C.nav('nav_patients');
      await sleep(1200);
      const out = {};
      out.dockThere = C.shown('#mlsDock');
      out.side = document.body.getAttribute('data-mls-dock') || '';
      /* 40: the collapsed side-rail finder is an icon, not a clipped sentence. */
      const ask = document.getElementById('mlsDockAsk');
      out.ask = ask ? { w: Math.round(ask.getBoundingClientRect().width), ph: ask.placeholder, aria: ask.getAttribute('aria-label') } : null;
      /* 73 / 123: a bar with tabs does not also say it has nothing to say. */
      const rn = document.getElementById('mlsRightNow');
      out.rightNow = rn ? { segs: rn.querySelectorAll('.segbtn').length, text: (rn.innerText || '').replace(/\s+/g, ' ').trim() } : null;
      /* 43 / 143 / 144: the Tools menu fits, sits beside the dock, and is legible. */
      const tools = Array.prototype.slice.call(document.querySelectorAll('#mlsDock button'))
        .filter((b) => /tools/i.test(b.textContent || ''))[0];
      if (tools) tools.click();
      await sleep(700);
      const m = document.getElementById('mlsToolsMenu');
      const r = m ? m.getBoundingClientRect() : null;
      out.tools = r ? { bottom: Math.round(r.bottom), viewport: window.innerHeight, scrolls: m.scrollHeight > m.clientHeight + 2 } : null;
      out.toolsOverDock = C.overlap('#mlsToolsMenu', '#mlsDock');
      out.toolsTiny = Array.prototype.slice.call(document.querySelectorAll('#mlsToolsMenu *'))
        .filter(C.visible)
        .filter((e) => (e.textContent || '').trim() && parseFloat(getComputedStyle(e).fontSize) < 12).length;
      /* 81: a promotion stands down while a menu is open. */
      out.menuFlag = document.body.getAttribute('data-mls-clunky-menu');
      if (tools) tools.click();
      await sleep(400);
      /* 95: an error toast does not look like a success toast.
         Measured off the CASCADE, not off a live toast: quietnotify-1.0.0
         routes an OUTCOME message to the tray instead of showing it, so
         calling toast() twice and reading #toast measures whichever one
         happened to survive - it read the same colour for both in a first
         attempt at this assertion. Two detached nodes carrying the real
         classes answer the actual question, which is whether the stylesheet
         distinguishes them. */
      const swatch = (cls) => {
        const n = document.createElement('div');
        n.id = 'toast';
        n.className = cls;
        n.style.cssText = 'position:fixed;left:-9999px;top:0;width:10px;height:10px';
        document.body.appendChild(n);
        const bg = getComputedStyle(n).backgroundColor;
        n.remove();
        return bg;
      };
      out.okBg = swatch('toast show ok');
      out.errBg = swatch('toast show err');
      out.warnBg = swatch('toast show warn');
      /* 15 / 97: the banner layer is anchored to the dock's reserved band. */
      out.banners = ['mlsUpgradeReadyNotice', 'mlsSignInPrompt', 'mlsQuotaChip'].map((id) => {
        const probe = document.createElement('div');
        probe.id = id;
        probe.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:40px';
        document.body.appendChild(probe);
        const b = getComputedStyle(probe).bottom;
        const l = getComputedStyle(probe).left;
        probe.remove();
        return { id: id, bottom: b, left: l };
      });
      out.clearBottom = getComputedStyle(document.documentElement).getPropertyValue('--mls-dock-clear-bottom').trim();
      out.clearLeft = getComputedStyle(document.documentElement).getPropertyValue('--mls-dock-clear-left').trim();
      return out;
    });
    measured.dock = { side: dock.side, ask: dock.ask, tools: dock.tools, okBg: dock.okBg, errBg: dock.errBg,
      banners: dock.banners, clearLeft: dock.clearLeft };
    ok(dock.dockThere, 'the calm-shell dock did not mount, so nothing below was measured');
    ok(dock.ask && (dock.ask.w >= 90 || dock.ask.ph.length <= 3),
      `the side-rail finder is ${dock.ask && dock.ask.w}px wide with placeholder "${dock.ask && dock.ask.ph}" - it renders as "Asl" (CLUNKY 40)`);
    ok(dock.ask && dock.ask.aria, 'the dock finder lost its accessible name when it became an icon (CLUNKY 40)');
    ok(dock.rightNow && !(dock.rightNow.segs > 0 && /Nothing to do here yet/.test(dock.rightNow.text)),
      `the right-now bar shows ${dock.rightNow && dock.rightNow.segs} tabs AND "Nothing to do here yet" (CLUNKY 73, 123)`);
    ok(dock.tools && dock.tools.bottom <= dock.tools.viewport,
      `the Tools menu ends ${dock.tools && (dock.tools.bottom - dock.tools.viewport)}px below the bottom of the screen, so Log out is unreachable (CLUNKY 43)`);
    eq(dock.toolsOverDock, null, 'the Tools menu opens on top of the taskbar that opened it (CLUNKY 143)');
    eq(dock.toolsTiny, 0, `${dock.toolsTiny} labels in the Tools menu compute under 12px (CLUNKY 144)`);
    eq(dock.menuFlag, '1', 'nothing marks "a menu is open", so promo cards keep floating over it (CLUNKY 81)');
    ok(dock.okBg && dock.errBg && dock.warnBg && dock.okBg !== dock.errBg && dock.okBg !== dock.warnBg,
      `a success toast and an error toast are both ${dock.okBg} - severity is invisible (CLUNKY 95)`);
    for (const b of dock.banners) {
      ok(b.bottom !== '0px',
        `${b.id} is pinned to bottom:0 and lands on the dock instead of above it (CLUNKY 15, 97)`);
    }

    /* ============================================ ATHENA REVIEW SHEET ==== */
    const ath = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const out = { api: !!window.__mlsWriteFlow };
      if (!out.api) return out;
      try { const pts = getPatients(); if (typeof selectPatient === 'function') selectPatient(pts[0].id); } catch (e) {}
      await sleep(600);
      try { const nb = document.getElementById('noteBox'); if (nb) nb.value = 'PROCEDURE: Lumbar medial branch block'; } catch (e) {}
      try { window.__mlsWriteFlow.openUnifiedConfirmation({}); } catch (e) { out.openErr = String(e && e.message).slice(0, 120); }
      await sleep(1500);
      const card = document.getElementById('mlsAthenaUnifiedConfirm');
      out.opened = !!card;
      if (!card) return out;
      /* 26: engineering vocabulary is not in the doctor's half of the sheet. */
      out.jargon = ['manifest', 'auto-chain', 'catalog-bound', 'MLS patient ID']
        .filter((k) => (card.innerText || '').indexOf(k) >= 0);
      /* 21: nothing in the sheet ships open. */
      out.openFolds = Array.prototype.slice.call(card.querySelectorAll('details')).filter((d) => d.open).length;
      /* 23: the fix strip always offers the one thing to try next. */
      out.recheck = !!document.getElementById('mlsClunkyAthenaRecheck');
      /* 3: a disabled Confirm brings its reason with it. */
      const go = document.getElementById('mlsAthenaUnifiedGo');
      if (go) { go.disabled = true; go.dispatchEvent(new Event('change', { bubbles: true })); }
      await sleep(900);
      out.why = Array.prototype.slice.call(card.querySelectorAll('[data-mls-clunky-why="1"]')).map((n) => n.id);
      out.probePos = (function () { const n = document.getElementById('mlsAthenaUnifiedProbe'); return n ? getComputedStyle(n).position : null; })();
      /* 2 / 22: a receipt lands - the "nothing has changed yet" box and the
         footer verb must both stop lying. */
      const rec = document.getElementById('mlsAthenaUnifiedReceipt');
      if (rec) rec.innerHTML = '<div>Write reviewed note - VERIFIED - written and verified</div>';
      await sleep(1500);
      out.safety = (function () { const n = document.getElementById('mlsAthenaUnifiedSafety'); return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : ''; })();
      out.goText = go ? (go.textContent || '').trim() : '';
      try { window.__mlsWriteFlow.closeUnifiedConfirmation(); } catch (e) {}
      return out;
    });
    measured.athena = { jargon: ath.jargon, openFolds: ath.openFolds, why: ath.why, goText: ath.goText };
    ok(ath.api && ath.opened, 'the Athena review sheet did not open, so nothing below was measured');
    eq(ath.jargon && ath.jargon.length, 0,
      `the review sheet still reads: ${(ath.jargon || []).join(', ')} (CLUNKY 26)`);
    eq(ath.openFolds, 0, `${ath.openFolds} disclosures in the review sheet ship OPEN (CLUNKY 21)`);
    ok(ath.recheck, 'the fix strip has no permanent "Check Athena again", so the instruction points at nothing (CLUNKY 23)');
    ok(ath.why && ath.why.indexOf('mlsAthenaUnifiedProbe') >= 0,
      'a disabled Confirm & Send is shown with its reason left below the fold (CLUNKY 3)');
    eq(ath.probePos, 'sticky', 'the read-only status line does not travel with the footer (CLUNKY 3)');
    ok(!/Nothing has changed yet/.test(ath.safety),
      `after a VERIFIED receipt the sheet still says "${ath.safety.slice(0, 40)}..." (CLUNKY 2)`);
    eq(ath.goText, 'Done',
      `after a verified write the grey button still reads "${ath.goText}" - a verb it already performed (CLUNKY 22)`);

    /* ======================================================= CALENDAR ==== */
    const cal = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      C.nav('nav_calendar');
      await sleep(1800);
      const card = document.querySelector('#calendarView .cx-glance');
      const line = document.getElementById('mlsClunkyCalLine');
      return {
        cardShown: !!(card && C.visible(card)),
        cardHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
        line: line ? (line.textContent || '').trim() : null,
        lineShown: C.shown('#mlsClunkyCalLine'),
        /* A DIFFERENTIAL, NOT A THRESHOLD. #calGrid is legitimately narrow in
           some states (the audit measured 421px with the day panel open), so
           an absolute floor fails on a state this block did not cause. What
           this block must never do is make the grid NARROWER, so the same
           page is measured with its stylesheet on and off. */
        gridW: await (async () => {
          const g = () => { const n = document.getElementById('calGrid'); return n ? Math.round(n.getBoundingClientRect().width) : null; };
          const on = g();
          const css = document.getElementById('mlsClunkyCalCss');
          if (!css) return { on: on, off: on };
          css.disabled = true;
          await sleep(250);
          const off = g();
          css.disabled = false;
          await sleep(250);
          return { on: on, off: off };
        })(),
        /* clunky-cal-1.0.1 (owner 2026-08-18, "WTF happened to calendar"): with
           the DAY PANEL OPEN the shell turns #calSplitWrap into a two-column
           grid; the line used to sit INSIDE that wrap and shoved the month
           grid into the narrow right column (measured live: 480px of 2320).
           The line must live outside the wrap, and the grid must keep the
           first column. Executed, not grepped: open the panel, measure. */
        placement: await (async () => {
          const wrap = document.getElementById('calSplitWrap');
          const grid = document.getElementById('calGrid');
          const panel = document.getElementById('calDayPanel');
          const ln = document.getElementById('mlsClunkyCalLine');
          if (!wrap || !grid || !panel) return { skipped: 'no-split-wrap' };
          const before = panel.getAttribute('style');
          panel.setAttribute('style', 'display:block;' + (before || '').replace(/display\s*:[^;]*;?/g, ''));
          await sleep(300);
          try { if (typeof window.__mlsClunkyCal === 'object' && window.__mlsClunkyCal && typeof window.__mlsClunkyCal.pass === 'function') window.__mlsClunkyCal.pass(); } catch (e) {}
          await sleep(300);
          const wr = wrap.getBoundingClientRect(), gr = grid.getBoundingClientRect();
          const out = {
            lineInsideWrap: !!(ln && ln.parentElement === wrap),
            gridLeftDelta: Math.round(gr.left - wr.left),
            gridW: Math.round(gr.width), wrapW: Math.round(wr.width),
            wrapDisplay: getComputedStyle(wrap).display
          };
          if (before === null) panel.removeAttribute('style'); else panel.setAttribute('style', before);
          return out;
        })()
      };
    });
    measured.calendar = cal;
    if (!cal.placement.skipped) {
      ok(!cal.placement.lineInsideWrap,
        'the calendar numbers line sits INSIDE #calSplitWrap and takes a grid track of its own when the day panel is open (clunky-cal-1.0.1)');
      ok(cal.placement.gridLeftDelta <= 2,
        `with the day panel open the MONTH GRID starts ${cal.placement.gridLeftDelta}px right of its wrap (${cal.placement.gridW}px of ${cal.placement.wrapW}px, ${cal.placement.wrapDisplay}) - it was pushed into the second column (clunky-cal-1.0.1)`);
    }
    ok(!cal.cardShown,
      `the 250px "DAY AT A GLANCE" card is back on the calendar (${cal.cardHeight}px) alongside the colour legend (CLUNKY 112)`);
    ok(cal.lineShown && /booked/.test(cal.line || ''),
      `the day's numbers went away with the card instead of moving to one line (got "${cal.line}") (CLUNKY 112)`);
    ok(cal.gridW && cal.gridW.on >= cal.gridW.off - 2,
      `this block's stylesheet NARROWS #calGrid: ${cal.gridW.off}px without it, ${cal.gridW.on}px with it - a crowding fix that spends its clearance somewhere invisible (CLUNKY 34 guard)`);

    /* ================================= CALENDAR / caldata-1.0.0 ======== */
    /* CLUNKY 33, 34, 35 - the items two lanes reported unreachable. See
       __clunky.seedCalendarMonth for why "seeding _calAppts rendered 0 chips"
       was a measurement artefact and what the real data source is.

       MEASURED at HEAD (1280x800, this seeded month): month 105 of 105 chips
       clipped at clientWidth 81px against scrollWidth 111-151px reading
       "8:00 AM Ada Sa..."; week 30 of 30 clipped in 90px lanes; Day view
       showing every patient twice (the uxpack chip strip AND the hour
       timeline) with #calGrid squeezed to 421px by the day panel it opened
       over itself. */
    const seedCal = await page.evaluate(() => window.__clunky.seedCalendarMonth());
    measured.calSeed = seedCal;
    eq(seedCal.applied, true,
      'loadCalendar() did not apply the seeded month - the calendar is not reading /api/appointments any more');
    eq(seedCal.count, seedCal.rows,
      `loadCalendar applied ${seedCal.count} of ${seedCal.rows} seeded appointments`);

    /* The two label helpers are EXECUTED, never grepped. A regex that lost a
       backslash in transport still reads correctly in the source - that is
       exactly how four shipped /1p regexes died with a green gate. */
    const helpers = await page.evaluate(() => ({
      times: ['8:00 AM', '9:30 AM', '1:00 PM', '12:15 PM', '', 'time not recorded']
        .map((s) => window._calCompactTime(s)),
      names: ['Ada Sample', 'Bo Van Der Berg', 'Cher', '', '  Dee   Sample  ']
        .map((s) => window._calShortWho(s))
    }));
    measured.calHelpers = helpers;
    eq(helpers.times.join('|'), '8a|9:30a|1p|12:15p||time not recorded',
      `_calCompactTime no longer compacts the clock (got ${JSON.stringify(helpers.times)}) - an eaten backslash in its regex would look exactly like this (CLUNKY 34/35)`);
    eq(helpers.names.join('|'), 'Ada S.|Bo B.|Cher||Dee S.',
      `_calShortWho no longer shortens the name (got ${JSON.stringify(helpers.names)}) (CLUNKY 34/35)`);

    const calx = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const gw = () => { const n = document.getElementById('calGrid'); return n ? Math.round(n.getBoundingClientRect().width) : null; };
      const out = {};

      window.calSetMode('month'); await sleep(800);
      out.month = { chips: C.calChips().length, clipped: C.calClipped(), gridW: gw(),
        sample: C.calChips().slice(0, 3).map((c) => (c.textContent || '').trim()) };

      /* DIFFERENTIAL, the same shape as the CLUNKY 34 guard above: this
         block's stylesheet narrows the RAIL's track, so it may only ever give
         #calGrid room. Measured with the sheet on and off on the same page.

         THE DAY PANEL MUST BE HELD SHUT FOR BOTH READS. #calSplitWrap becomes
         a two-column grid whenever #calDayPanel is displayed, which moves
         #calGrid by ~400px - two orders of magnitude more than the rail track
         this differential is trying to measure. The first version of this
         check read 870px "on" and 470px "off" and PASSED, but the 400px was
         the panel opening between the two reads, not the stylesheet. Both
         reads now force the panel shut first and the panel state is returned
         so a silent drift cannot fake the verdict again. Something on this
         screen re-opens the panel on its own tick, so the pair is RETRIED
         until both reads agree on the layout rather than forced once and
         trusted. */
      const panelOpen = () => window.__clunky.shown('#calDayPanel');
      const css = document.getElementById('mlsCalDataCss');
      out.tries = 0;
      for (let attempt = 0; attempt < 6; attempt++) {
        out.tries++;
        const p = document.getElementById('calDayPanel');
        if (p) p.style.display = 'none';
        await sleep(400);
        const onPanel = panelOpen();
        const onW = gw();
        if (css) css.disabled = true;
        if (p) p.style.display = 'none';
        await sleep(400);
        const offPanel = panelOpen();
        const offW = gw();
        if (css) css.disabled = false;
        await sleep(300);
        out.panelOn = onPanel; out.panelOff = offPanel;
        out.gridOn = onW; out.gridOff = offW;
        if (onPanel === offPanel) break;
      }
      if (!css) { out.gridOff = out.gridOn; out.panelOff = out.panelOn; }

      window._calRefDate = '2026-08-17'; window.calSetMode('week'); await sleep(800);
      out.week = { chips: C.calChips().length, clipped: C.calClipped(),
        sample: C.calChips().slice(0, 3).map((c) => (c.textContent || '').trim()) };

      window._calRefDate = '2026-08-17'; window.calSetMode('day'); await sleep(800);
      const t = (document.getElementById('calendarView') || {}).innerText || '';
      const day = (window._calAppts || []).filter((a) => a.appt_date === '2026-08-17');
      out.day = { chips: C.calChips().length, rows: day.length, gridW: gw(),
        panelShown: C.shown('#calDayPanel'),
        modeAttr: (document.getElementById('calendarView') || {}).getAttribute
          ? document.getElementById('calendarView').getAttribute('data-cal-mode') : null,
        maxCopies: day.reduce((m, a) => Math.max(m, t.split(a.name).length - 1), 0) };

      window.calSetMode('month'); await sleep(400);
      return out;
    });
    measured.caldata = calx;

    /* The seed must actually reach the grid, or every assertion below is
       vacuous - which is precisely how this item stayed "open" twice. */
    ok(calx.month.chips > 40,
      `the seeded month rendered only ${calx.month.chips} chips - the grid is not reading the appointments and the CLUNKY 34/35 checks would pass vacuously`);
    eq(calx.month.clipped, 0,
      `${calx.month.clipped} of ${calx.month.chips} month chips are still clipped (e.g. ${JSON.stringify(calx.month.sample)}) - the month is unreadable again (CLUNKY 34)`);
    /* The differential is only evidence if both reads saw the same layout. */
    eq(calx.panelOn, calx.panelOff,
      `the CLUNKY 34 differential read #calGrid in two different layouts after ${calx.tries} attempts (day panel visible on:${calx.panelOn} off:${calx.panelOff}) - the ~400px two-column split would swamp the rail track this is measuring`);
    ok(calx.gridOn >= calx.gridOff - 2,
      `caldata's stylesheet NARROWS #calGrid: ${calx.gridOff}px without it, ${calx.gridOn}px with it - the rail is a layout track and this fix must only ever give the grid room (CLUNKY 34 guard)`);
    ok(calx.gridOn > calx.gridOff,
      `caldata's stylesheet gives #calGrid no width at all (${calx.gridOff}px -> ${calx.gridOn}px): item 34's whole claim is that the rail's track can be narrower`);

    ok(calx.week.chips > 10,
      `week view rendered only ${calx.week.chips} chips - the CLUNKY 35 check would pass vacuously`);
    eq(calx.week.clipped, 0,
      `${calx.week.clipped} of ${calx.week.chips} week chips are clipped (e.g. ${JSON.stringify(calx.week.sample)}) - the surname is being sliced in the lane again (CLUNKY 35)`);

    ok(!calx.day.panelShown,
      `Day view opened the right-hand day panel over its own hour timeline again, squeezing #calGrid to ${calx.day.gridW}px (CLUNKY 33)`);
    eq(calx.day.modeAttr, 'day',
      'renderCalendar no longer publishes data-cal-mode on #calendarView, so the rule that stands the duplicate day-chip strip down cannot match (CLUNKY 33)');
    eq(calx.day.maxCopies, 1,
      `a Day-view patient is on screen ${calx.day.maxCopies} times over ${calx.day.rows} appointments - the timeline is repeating what another strip already said (CLUNKY 33)`);

    /* ============================ CLUNKY 38: More calendar tools ======= */
    /* MEASURED at HEAD, month mode: pressing "More calendar tools" took
       #calendarView from 9 to 56 visible controls, 49 of them under 40px -
       and 33 of those 47 were ONE thing, the rail's mini-month (31 day
       buttons + two arrows), a second month grid disclosed beside the real
       one.

       THE FOLD CONTRACT IS NOT WEAKENED. feat_mls_calm_views.js's promise is
       that everything it folds has a route back IN THE SAME VIEW. The
       mini-month keeps that route in day and week mode, where it is the only
       month picker on screen; it is suppressed only in MONTH mode, where the
       thing being disclosed is a copy of the grid already on screen. Both are
       measured below - hidden in month, and really there AND clickable in day
       and week. */
    const more = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const discl = () => Array.prototype.slice.call(
        document.querySelectorAll('#calendarView button,#calendarView [role=button]'))
        .find((b) => /more calendar tools/i.test(b.textContent || ''));
      const miniState = () => {
        const el = document.querySelector('#calendarView .cx-card.cx-mini');
        if (!el) return { present: false, shown: false, days: 0 };
        const days = Array.prototype.slice.call(el.querySelectorAll('.cx-mini-day')).filter(C.visible);
        return { present: true, shown: C.visible(el), days: days.length,
          clickable: days.length ? !!days[0].onclick : false };
      };
      const openMore = async () => {
        const b = discl();
        if (!b) return false;
        if (/^hide/i.test((b.textContent || '').trim())) return true;   /* already open */
        b.click(); await sleep(900);
        return true;
      };

      const out = {};
      /* --- month --- */
      window.calSetMode('month'); await sleep(700);
      out.beforeCtrls = C.ctrls('#calendarView').length;
      out.hasDisclosure = !!discl();
      out.opened = await openMore();
      /* Counted off the ELEMENTS, not off C.ctrls()'s label strings: mapping
         a label back to a node matches the wrong one whenever two controls
         share a label, which is exactly what a duplicate-heavy panel has. */
      const CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=menuitem]';
      const afterEls = Array.prototype.slice.call(document.querySelectorAll('#calendarView ' + CTRL)).filter(C.visible);
      out.afterCtrls = afterEls.length;
      out.afterUnder40 = afterEls.filter((e) => e.getBoundingClientRect().height < 40).length;
      out.month = miniState();

      /* --- day and week: the route back must still work --- */
      window._calRefDate = '2026-08-17'; window.calSetMode('day'); await sleep(700);
      await openMore();
      out.day = miniState();
      window.calSetMode('week'); await sleep(700);
      await openMore();
      out.week = miniState();

      window.calSetMode('month'); await sleep(500);
      return out;
    });
    measured.calMore = more;
    ok(more.hasDisclosure,
      'the "More calendar tools" disclosure is not on the calendar, so the CLUNKY 38 checks would pass vacuously');
    ok(more.month.present,
      'the rail mini-month is gone from the DOM entirely - CLUNKY 38 hides it in month mode, it must never be deleted');
    ok(!more.month.shown,
      `"More calendar tools" still discloses the rail's mini-month in MONTH mode (${more.month.days} day buttons) beside the month grid it copies (CLUNKY 38)`);
    ok(more.afterCtrls < 30,
      `"More calendar tools" opens ${more.afterCtrls} visible controls in month mode (was 56 at HEAD, 33 of them the duplicate mini-month) (CLUNKY 38)`);
    /* The route back, both directions - a fold with a dead disclosure is the
       defect feat_mls_calm_views.js exists to prevent. */
    ok(more.day.shown && more.day.days >= 28,
      `day mode: "More" no longer reveals a usable mini-month (shown ${more.day.shown}, ${more.day.days} day buttons) - the fold's route back is dead (CLUNKY 38)`);
    ok(more.day.clickable,
      'day mode: the disclosed mini-month day cells lost their click handler (CLUNKY 38)');
    ok(more.week.shown && more.week.days >= 28,
      `week mode: "More" no longer reveals a usable mini-month (shown ${more.week.shown}, ${more.week.days} day buttons) (CLUNKY 38)`);

    /* ================================================================== */
    /* ============ clunky2 lane (2026-08-18) =========================== */
    /* ================================================================== */

    /* ===================================== PULL PROGRESS DIALOG ======== */
    /* MEASURED at HEAD with a seeded 23-patient run in its day-note phase:
     *   #mlsPullProgStop  color rgb(255,180,166) on rgb(255,255,255) - the
     *                     dark-theme tint painted on a white card, ~1.7:1
     *   headline          "23 of 23"  while the pill said "Pulling 23/23",
     *                     the bar was held at 99% and a THIRD count,
     *                     "reading today's notes 7 of 23", ran underneath
     *   tally             SIX clauses on one line
     *   after Stop        "Hide (keep pulling)" and a subtitle still saying
     *                     "this keeps going on its own"
     *   DONE card         [data-pp=tally] === [data-pp=current], the same
     *                     sentence twice, and a note naming "Retry failed
     *                     histories" beside a card whose only button was Done
     */
    const pull = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const out = { api: !!window.__mlsPullProgress };
      if (!out.api) return out;
      const rows = [];
      for (let i = 0; i < 9; i++) {
        rows.push({ k: 'k' + i, name: 'Syn ' + i, ok: i < 6, done: true,
          reason: i < 6 ? '' : 'read-failed', sp: i === 5, cs: i === 7,
          dn: i === 1 ? 'retrying:slow' : (i === 2 ? 'unread:timeout' : '') });
      }
      window.__mlsDayHistoryPull = { state: {
        running: true, total: 23, done: 23, ok: 6, failed: 3, chartOnly: 1,
        current: 'Syn 0', rows: rows, phase: { kind: 'day-notes', done: 7, total: 23 }
      } };
      await sleep(1400);
      const fab = document.getElementById('mlsPullProgFab');
      out.fab = fab ? (fab.textContent || '').trim() : null;
      if (fab) fab.click();
      await sleep(1400);
      const p = document.getElementById('mlsPullProgPanel');
      out.panel = !!p;
      if (!p) return out;
      const g = (k) => { const n = p.querySelector('[data-pp="' + k + '"]'); return n ? (n.textContent || '').trim() : null; };
      out.big = g('done') + ' of ' + g('total');
      out.phase = g('phase');
      out.pct = g('pct');
      out.tally = g('tally');
      out.tallyClauses = (g('tally') || '').split('·').length;
      out.detail = g('tallyMore');
      out.more = (function () { const d = p.querySelector('[data-pp="more"]'); return d ? { open: d.open, shown: getComputedStyle(d).display !== 'none' } : null; })();
      out.curLbl = g('curLbl');
      out.current = g('current');
      /* 70: read the COMPUTED colour off the live button, on the live card. */
      const sb = document.getElementById('mlsPullProgStop');
      out.stop = sb ? { color: getComputedStyle(sb).color, bg: getComputedStyle(sb.closest('.ppc') || p).backgroundColor } : null;
      out.hide = (function () { const n = document.getElementById('mlsPullProgHide'); return n ? (n.textContent || '').trim() : null; })();
      /* 128: press Stop, then HIDE and re-show - the stopping state must
         survive the rebuild, which is what a label-only fix could not do. */
      if (sb) sb.click();
      await sleep(1200);
      const hideBtn = document.getElementById('mlsPullProgHide');
      if (hideBtn) hideBtn.click();
      await sleep(1200);
      const fab2 = document.getElementById('mlsPullProgFab');
      if (fab2) fab2.click();
      await sleep(1400);
      const p2 = document.getElementById('mlsPullProgPanel');
      out.afterStop = p2 ? {
        stop: (function () { const n = document.getElementById('mlsPullProgStop'); return n ? (n.textContent || '').trim() : null; })(),
        hide: (function () { const n = document.getElementById('mlsPullProgHide'); return n ? (n.textContent || '').trim() : null; })(),
        sub: (function () { const n = p2.querySelector('.pp-sub'); return n ? (n.textContent || '').trim() : ''; })()
      } : null;
      /* 72 / 127: the finished card. */
      window.__mlsDayHistoryPull.state.running = false;
      window.__mlsDayHistoryPull.state.phase = null;
      window.__mlsDayHistoryPull.state.finishedAt = Date.now();
      await sleep(1800);
      const p3 = document.getElementById('mlsPullProgPanel');
      out.done = p3 ? {
        tally: (function () { const n = p3.querySelector('[data-pp="tally"]'); return n ? (n.textContent || '').trim() : null; })(),
        current: (function () { const n = p3.querySelector('[data-pp="current"]'); return n ? (n.textContent || '').trim() : null; })(),
        note: (function () { const n = p3.querySelector('.pp-note'); return n ? (n.textContent || '').trim() : ''; })(),
        retryShown: C.shown('#mlsPullProgRetry'),
        stripThere: !!document.getElementById('mlsDsRetryHistoryBtn'),
        ctrls: C.ctrls('#mlsPullProgPanel')
      } : null;
      /* leave the app as it was found */
      try { window.__mlsDayHistoryPull = { state: null }; } catch (e) {}
      await sleep(1200);
      return out;
    });
    measured.pull = { fab: pull.fab, big: pull.big, tally: pull.tally, stop: pull.stop,
      afterStop: pull.afterStop, done: pull.done && { tally: pull.done.tally, retry: pull.done.retryShown } };
    ok(pull.api && pull.panel, 'the pull progress panel did not open, so nothing below was measured');
    eq(pull.big, '7 of 23',
      `during the day-note phase the headline reads "${pull.big}" - a finished count on an unfinished pull (CLUNKY 71)`);
    ok(/Today’s notes/.test(pull.phase || ''),
      `the headline does not say WHICH count it is showing (got "${pull.phase}") (CLUNKY 71)`);
    ok(/Today’s notes 7\/23/.test(pull.fab || ''),
      `the pill still counts finished histories during the day-note phase: "${pull.fab}" (CLUNKY 71)`);
    eq(pull.curLbl, 'Now:', `the "now" box is labelled "${pull.curLbl}" while its counts moved to the headline (CLUNKY 71)`);
    ok(!/\d+ of \d+/.test(pull.current || ''),
      `the "now" box prints the phase counts a third time: "${pull.current}" (CLUNKY 71)`);
    ok(pull.tallyClauses <= 2,
      `the running tally is ${pull.tallyClauses} clauses on one line: "${pull.tally}" (CLUNKY 127)`);
    ok(/need attention/.test(pull.tally || '') && /saved/.test(pull.tally || ''),
      `the tally must still carry both numbers, got "${pull.tally}" (CLUNKY 127)`);
    ok(pull.detail && pull.detail.indexOf('each row below says why') >= 0,
      'the full tally wording was DELETED rather than folded - the detail must keep every clause (CLUNKY 127)');
    ok(pull.more && pull.more.shown && pull.more.open === false,
      'the tally detail is not behind a CLOSED fold (CLUNKY 127)');
    /* 70: a real contrast ratio off the two computed colours. */
    const lum = (css) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css || '');
      if (!m) return null;
      const ch = [1, 2, 3].map((i) => {
        const v = Number(m[i]) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    };
    const lFg = lum(pull.stop && pull.stop.color), lBg = lum(pull.stop && pull.stop.bg);
    const ratio = (lFg == null || lBg == null) ? null
      : (Math.max(lFg, lBg) + 0.05) / (Math.min(lFg, lBg) + 0.05);
    measured.pullStopContrast = ratio && Math.round(ratio * 100) / 100;
    ok(ratio && ratio >= 4.5,
      `"Stop pull" computes ${pull.stop && pull.stop.color} on ${pull.stop && pull.stop.bg} - contrast ${ratio && ratio.toFixed(2)}:1, under 4.5 (CLUNKY 70)`);
    eq(pull.afterStop && pull.afterStop.hide, 'Hide',
      `after Stop the card still offers "${pull.afterStop && pull.afterStop.hide}" (CLUNKY 128)`);
    ok(pull.afterStop && /Finishing the current chart/.test(pull.afterStop.sub),
      `after Stop the subtitle still says the pull "keeps going on its own": "${(pull.afterStop && pull.afterStop.sub || '').slice(0, 60)}" (CLUNKY 128)`);
    ok(pull.afterStop && /Stopping after this chart/.test(pull.afterStop.stop || ''),
      'the stopping state did not survive Hide → show, so it was a label and not a state (CLUNKY 128)');
    ok(pull.done && pull.done.tally !== pull.done.current,
      `the finished card prints the same sentence twice: "${pull.done && pull.done.tally}" (CLUNKY 127)`);
    /* 72 is a TWO-SIDED rule: the note may name Retry only when Retry is there. */
    ok(pull.done && (pull.done.retryShown === (/"Retry failed histories" below/.test(pull.done.note))),
      `the DONE card names a control it does not show (retry button ${pull.done && pull.done.retryShown}, note "${(pull.done && pull.done.note || '').slice(0, 70)}") (CLUNKY 72)`);
    if (pull.done && pull.done.stripThere) {
      ok(pull.done.retryShown,
        'the Visit day strip has a real Retry control and the finished card still does not offer it (CLUNKY 72)');
    }

    /* ============================================ LEGAL / IME ========== */
    /* MEASURED at HEAD, bound to a synthetic patient:
     *   badge      "Free 1p preview · read-only draft workspace"
     *   first line "No signing, delivery, chart filing, EMR writing, payment,
     *               messaging, or public intake."
     *   file help  339 characters
     *   letterhead FOUR lines of "[The practice name is not configured - set
     *              it in Settings before this report is signed]"
     *   patient changed → a page headed "No bound patient workspace" with
     *              exactly ONE control on it (Close preview)
     */
    const legal = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const out = {};
      /* The pack reads the shell's LEXICAL bkUser (a top-level `let`, so it is
         NOT window.bkUser); assigning the bare identifier is the only way in. */
      try { bkUser = { id: 'harness', email: 'ui-harness@mlsscribe.test', role: 'doctor', name: 'Sample Provider, MD' }; } catch (e) { out.userErr = 1; }
      if (!window.__mlsP1LegalPack) return out;
      try { selectPatient(getPatients()[0].id); } catch (e) {}
      await sleep(700);
      out.opened = window.__mlsP1LegalPack.open();
      await sleep(2200);
      const root = document.getElementById('mlsP1LegalRoot');
      out.root = !!root;
      if (!root) return out;
      const t = root.innerText || '';
      out.jargon = ['read-only draft workspace', 'Free 1p preview', 'No signing, delivery, chart']
        .filter((k) => t.indexOf(k) >= 0);
      out.fileHelpLen = C.text('#mlsP1LegalFileHelp').length;
      /* the AI disclosure is a GUARD, not clutter - it must stay visible */
      out.disclosure = /extracted text from files still listed here is included/.test(C.text('#mlsP1LegalFileHelp'));
      out.letterhead = C.text('#mlsP1LegalLetterheadPreview');
      out.brackets = (out.letterhead.match(/\[[^\]]{10,170}\]/g) || []).length;
      out.lhWarn = C.text('#mlsClunkyLegalLhWarn');
      /* PRESENCE, not a rect: the whole Letterhead fieldset lives inside the
         "Generate the report" disclosure, which ships CLOSED, so every rect
         in it is legitimately zero. Chrome also keeps layout boxes for a
         closed <details> subtree, which is the trap this suite already
         documents - so ask what the DOM says, not what the box says. */
      out.lhBtn = (function () {
        const b = document.getElementById('mlsClunkyLegalLhSettings');
        return b ? { tag: b.tagName, text: (b.textContent || '').trim(),
          inWarn: !!b.closest('#mlsClunkyLegalLhWarn') } : null;
      })();
      /* the generated document is NOT changed - two suites pin its wording */
      out.block = window.__mlsP1LegalPack.letterheadBlock();
      /* 54 */
      try { selectPatient(getPatients()[1].id); } catch (e) {}
      await sleep(2000);
      out.after = {
        ctrls: C.ctrls('#mlsP1LegalRoot'),
        text: C.text('#mlsP1LegalRoot'),
        reopen: C.shown('#mlsClunkyLegalReopen')
      };
      try { window.__mlsP1LegalPack.close(); } catch (e) {}
      await sleep(400);
      return out;
    });
    measured.legal = { jargon: legal.jargon, fileHelpLen: legal.fileHelpLen, brackets: legal.brackets,
      afterCtrls: legal.after && legal.after.ctrls };
    ok(legal.opened && legal.root, 'the Legal / IME workspace did not open, so nothing below was measured');
    eq(legal.jargon.length, 0,
      `the Legal workspace still opens with: ${legal.jargon.join(' | ')} (CLUNKY 52)`);
    ok(legal.fileHelpLen <= 200,
      `the local-records help is ${legal.fileHelpLen} characters of paragraph above the button it describes (CLUNKY 52)`);
    ok(legal.disclosure,
      'the AI extracted-text disclosure was paraphrased out of the visible copy - that is a guard, not clutter (CLUNKY 52 guard)');
    eq(legal.brackets, 0,
      `the letterhead preview still prints ${legal.brackets} bracketed instructions to the doctor (CLUNKY 53)`);
    ok(/not set/.test(legal.letterhead || ''),
      'the letterhead preview no longer says which fields are missing (CLUNKY 53)');
    ok(/Letterhead incomplete/.test(legal.lhWarn || '') && legal.lhBtn && legal.lhBtn.tag === 'BUTTON' && legal.lhBtn.inWarn,
      `an incomplete letterhead has no single warning with a way to fix it (got "${(legal.lhWarn || '').slice(0, 40)}", button ${JSON.stringify(legal.lhBtn)}) (CLUNKY 53)`);
    ok(/\[The practice name is not configured/.test(legal.block || ''),
      'the GENERATED letterhead stopped refusing in the open - an unset practice name must never print as a blank line (CLUNKY 53 guard)');
    ok(legal.after && legal.after.ctrls.length >= 2 && legal.after.reopen,
      `switching patients still leaves a dead end with ${legal.after && legal.after.ctrls.length} control(s) (CLUNKY 54)`);
    ok(legal.after && !/discarded every in-progress result/.test(legal.after.text),
      'the patient-changed page still explains itself in release language (CLUNKY 54)');

    /* ================================================ SIGN-IN ========== */
    const signin2 = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const a = document.getElementById('authScreen'), s = document.getElementById('appScreen');
      if (a) a.style.display = ''; if (s) s.style.display = 'none';
      await sleep(600);
      const out = {
        preview: C.rect('#authPreviewLink'),
        btn: C.rect('#authBtn'),
        noteWords: (C.text('#authNote') || '').split(/\s+/).filter(Boolean).length,
        noteFold: !!document.querySelector('#authNote details'),
        noteKeeps: /Clinical workspace access is checked separately/.test(
          (document.getElementById('authNote') || {}).textContent || '')
      };
      /* 44: the locked clinical gate */
      try { showAgreementsGate(false); } catch (e) { out.gateErr = 1; }
      await sleep(500);
      out.gate = {
        summary: C.text('#agGateSummary'),
        err: C.text('#agGateErr'),
        words: (C.text('#agreementsGate .card') || '').split(/\s+/).filter(Boolean).length,
        blocks: C.busy('#agreementsGate'),
        folds: document.querySelectorAll('#agLockedWrap details').length,
        /* THE MEASURE IS RESTATEMENT, not word count: at HEAD three separate
           visible blocks each carried the same refusal - the grey summary
           ("not enabled for this deployment or account"), the amber box
           ("separate checks ... cannot change deployment readiness") and the
           red status line ("could not be verified"). Own text per element, so
           a <b> inside a <p> is one block and not two, and anything inside
           the closed fold is excluded by the helper. The HEADING is a label,
           not a restatement, so it is excluded - what this counts is how many
           times the body of the screen says the same thing again. */
        restated: (function () {
          const RE = /not enabled|could not be verified|not been switched on|separate checks|cannot change deployment/i;
          let n = 0;
          Array.prototype.slice.call(document.querySelectorAll('#agreementsGate .card *')).forEach((e) => {
            if (!C.visible(e) || e.closest('h1,h2,h3')) return;
            let own = '';
            Array.prototype.slice.call(e.childNodes).forEach((x) => { if (x.nodeType === 3) own += x.nodeValue; });
            if (RE.test(own)) n++;
          });
          return n;
        })()
      };
      try { document.getElementById('agreementsGate').style.display = 'none'; } catch (e) {}
      if (a) a.style.display = 'none'; if (s) s.style.display = '';
      await sleep(400);
      return out;
    });
    measured.signin = signin2;
    ok(signin2.preview && signin2.btn && signin2.preview.h >= signin2.btn.h - 4,
      `"Explore a sample day" is a ${signin2.preview && signin2.preview.h}px strip under a ${signin2.btn && signin2.btn.h}px button (CLUNKY 138)`);
    ok(signin2.noteWords <= 18,
      `the sign-in screen still ends on a ${signin2.noteWords}-word paragraph (CLUNKY 139)`);
    ok(signin2.noteFold && signin2.noteKeeps,
      'the sign-in note was SHORTENED BY DELETION - every original word must survive behind the fold (CLUNKY 139 guard)');
    ok(signin2.gate.words <= 70,
      `the locked gate is ${signin2.gate.words} words over ${signin2.gate.blocks.blocks} blocks (CLUNKY 44)`);
    eq(signin2.gate.restated, 1,
      `the locked gate states its refusal in ${signin2.gate.restated} places at once (CLUNKY 44)`);
    eq(signin2.gate.folds, 1, 'the gate detail is not behind exactly one fold (CLUNKY 44)');
    ok(/administrator/i.test(signin2.gate.summary || ''),
      `the locked gate never says who can unlock it: "${(signin2.gate.summary || '').slice(0, 60)}" (CLUNKY 44)`);

    /* ================================================ HISTORY ========== */
    const hist = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const out = {};
      C.nav('nav_patients');
      await sleep(900);
      try { selectPatient(getPatients()[3].id); } catch (e) {}
      await sleep(900);
      out.barWithPatient = C.shown('#mlsCtxBar');
      try { deselectPatient(); } catch (e) {}
      await sleep(1400);
      out.barAfterDeselect = C.shown('#mlsCtxBar');
      out.activeAfterDeselect = (function () { try { return getActivePtId(); } catch (e) { return 'ERR'; } })();
      C.nav('nav_history');
      await sleep(2000);
      out.barOnHistory = C.shown('#mlsCtxBar');
      const hv = document.getElementById('historyView');
      const t = hv ? (hv.innerText || '') : '';
      out.readOnly = (t.match(/READ-ONLY/g) || []).length;
      out.pullOpen = (t.match(/Pull open Athena patient/g) || []).length;
      out.hero = { shown: C.shown('#mlsCvNxt_history'), text: C.text('#mlsCvNxt_history') };
      out.note = C.text('#mlsClunkyHistNote');
      /* the fix must UNDO itself the moment a patient is chosen again */
      try { selectPatient(getPatients()[0].id); } catch (e) {}
      await sleep(1800);
      out.back = { bar: C.shown('#mlsCtxBar'), hero: C.shown('#mlsCvNxt_history'),
        heroText: C.text('#mlsCvNxt_history'), note: C.shown('#mlsClunkyHistNote') };
      /* 51: a saved visit opens the note */
      saveNotes([{ id: 'n-clunky2', patientId: getPatients()[0].id, patient: getPatients()[0].name,
        date: '2026-08-10T09:00:00', text: 'PROCEDURE: Synthetic block\nFINDINGS: harness text only.' }]);
      try { renderHistory(); } catch (e) {}
      await sleep(900);
      /* feat_visit_note_detail.js is deferred and never arrives in a
         non-compositing tab; without it the legacy #viewModal opens instead
         and this room is not the one under test. */
      out.vndLoaded = !!window.__mlsVisitNoteDetail;
      if (!out.vndLoaded) {
        await new Promise((res) => {
          const s = document.createElement('script');
          s.src = 'feat_visit_note_detail.js?v=contract';
          s.setAttribute('data-mls-asset', 'feat_visit_note_detail.js');
          s.onload = () => res(); s.onerror = () => res();
          document.body.appendChild(s);
        });
        await sleep(1500);
        out.vndLoaded = !!window.__mlsVisitNoteDetail;
      }
      if (out.vndLoaded) {
        try { openNoteFromHistory('n-clunky2'); } catch (e) { out.openErr = 1; }
        await sleep(1600);
        const dlg = document.querySelector('.mlsvnd-scrim');
        out.dlg = !!dlg;
        if (dlg) {
          const dt = dlg.innerText || '';
          out.noteShown = /FINDINGS: harness text only/.test(dt);
          out.untagged = /untagged/i.test(dt);
          out.aiEmpty = /No AI summary yet/i.test(dt);
          out.rawOpen = !!(dlg.querySelector('details.mlsvd-raw') || {}).open;
          out.rawStillThere = !!dlg.querySelector('details.mlsvd-raw pre');
          dlg.remove();
        }
      }
      return out;
    });
    measured.history = hist;
    ok(hist.barWithPatient, 'the patient banner did not show for a chosen patient, so the deselect check below is vacuous');
    eq(hist.activeAfterDeselect, '', 'deselectPatient did not clear the active patient, so nothing below was measured');
    ok(!hist.barAfterDeselect, 'after ✕ Deselect the patient banner is still on screen (CLUNKY 49)');
    ok(!hist.barOnHistory, 'History re-paints the banner with the patient the doctor just deselected (CLUNKY 49)');
    eq(hist.readOnly, 0,
      `History with no patient still prints ${hist.readOnly} READ-ONLY pull captions (CLUNKY 50)`);
    eq(hist.pullOpen, 0,
      `History with no patient still says "Pull open Athena patient" ${hist.pullOpen} times (CLUNKY 50)`);
    /* 50 IS A RELABEL, NOT A HIDE. Hiding it was tried and 1p-nextglow-path
       -contract refused it: #mlsCvNxt_history is the ONE lit control on this
       room, and an invisible next step is a worse defect than a wrong one. So
       the button must still be there, must not claim to pull a chart for a
       patient who is not chosen, and must say what to do instead. */
    ok(hist.hero && hist.hero.shown,
      'the History next-step button is not on screen at all - the glow lane points at it by id (CLUNKY 50 guard)');
    ok(hist.hero && !/Pull chart from Athena/.test(hist.hero.text || ''),
      `with no patient the hero still offers "${(hist.hero && hist.hero.text || '').slice(0, 50)}" (CLUNKY 50)`);
    ok(hist.hero && /Choose a patient/.test(hist.hero.text || ''),
      `the hero does not name the real next step (got "${(hist.hero && hist.hero.text || '').slice(0, 50)}") (CLUNKY 50)`);
    ok(!/Choose a patient/.test(hist.note || ''),
      `the note repeats the hero's instruction instead of describing the list (got "${hist.note}") (CLUNKY 50)`);
    ok(hist.back && hist.back.bar && hist.back.hero && !hist.back.note &&
      /Pull chart from Athena/.test(hist.back.heroText || ''),
      `choosing a patient again does not restore the banner and the real hero label (got "${(hist.back && hist.back.heroText || '').slice(0, 40)}") - the fix is not reversible (CLUNKY 49, 50)`);
    ok(hist.vndLoaded, 'the saved-visit dialog module did not install, so CLUNKY 51 was not measured');
    ok(hist.dlg, 'the saved-visit dialog did not open, so CLUNKY 51 was not measured');
    ok(hist.noteShown, 'clicking a saved visit still shows everything except the note (CLUNKY 51)');
    ok(hist.rawOpen && hist.rawStillThere,
      'the note fold was emptied rather than opened (CLUNKY 51)');
    ok(!hist.untagged, 'the saved-visit dialog still leads with "Unknown / untagged" (CLUNKY 51)');
    ok(!hist.aiEmpty, 'the saved-visit dialog still shows an empty AI-summary slot (CLUNKY 51)');

    /* ============================== PATIENTS / STUDIO / RECS / WIZARD == */
    const rooms = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const out = {};
      C.nav('nav_patients');
      await sleep(1400);
      /* 124: Record leaves every row it is not wanted on */
      const items = Array.prototype.slice.call(document.querySelectorAll('#ptList .pt-item')).filter(C.visible);
      out.rows = items.length;
      out.recVisible = items.reduce((n, it) => n + Array.prototype.slice.call(it.querySelectorAll('button'))
        .filter((b) => /record/i.test(b.textContent || '') && C.visible(b) && getComputedStyle(b).visibility !== 'hidden').length, 0);
      /* the active row keeps its Record - the control is moved, not removed */
      out.activeRowKeeps = (function () {
        const act = document.querySelector('#ptList .pt-item.active');
        if (!act) return null;
        const b = Array.prototype.slice.call(act.querySelectorAll('button')).filter((x) => /record/i.test(x.textContent || ''))[0];
        return b ? getComputedStyle(b).visibility !== 'hidden' : null;
      })();
      /* 67: the picker opens on the second typed character, never on focus */
      const si = document.getElementById('ptSearch');
      if (si) {
        si.focus(); si.dispatchEvent(new Event('focus', { bubbles: true }));
        await sleep(600);
        out.pickOnFocus = C.shown('#mls-pick-dd');
        si.value = 'A'; si.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(450);
        out.pickOneChar = C.shown('#mls-pick-dd');
        si.value = 'Ad'; si.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(450);
        out.pickTwoChars = C.shown('#mls-pick-dd');
        si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(400);
        out.pickCleared = C.shown('#mls-pick-dd');
        si.blur();
      }
      /* 142: "AI Studio" once */
      C.nav('nav_studio');
      await sleep(1600);
      out.aiStudio = (function () {
        let n = 0;
        Array.prototype.slice.call(document.querySelectorAll('#appScreen *')).forEach((e) => {
          if (!C.visible(e)) return;
          let own = '';
          Array.prototype.slice.call(e.childNodes).forEach((x) => { if (x.nodeType === 3) own += x.nodeValue; });
          if (own.replace(/\s+/g, ' ').trim() === 'AI Studio') n++;
        });
        return n;
      })();
      /* 130: exactly one lit segment on a Review sub-screen */
      C.nav('nav_recs');
      await sleep(1800);
      out.recs = (function () {
        const rn = document.getElementById('mlsRightNow');
        if (!rn) return null;
        const segs = Array.prototype.slice.call(rn.querySelectorAll('.segbtn'));
        return { n: segs.length, lit: segs.filter((b) => b.classList.contains('on')).length,
          labels: segs.map((b) => (b.textContent || '').trim().slice(0, 18)) };
      })();
      C.nav('nav_patients');
      await sleep(1600);
      out.recsLeft = (function () {
        const rn = document.getElementById('mlsRightNow');
        return rn ? { mine: rn.querySelectorAll('[data-mls-clunky-seg="1"]').length,
          lit: rn.querySelectorAll('.segbtn.on').length } : null;
      })();
      /* 114 / 115: the wizard */
      try { openSetup(); } catch (e) { out.wizErr = 1; }
      await sleep(1300);
      try { SU_STEP = 1; suShow(); } catch (e) { out.suErr = 1; }
      await sleep(700);
      out.wiz = (function () {
        const x = document.querySelector('#setupModal .modal-x'), pr = document.getElementById('su_progress');
        if (!x || !pr) return null;
        const css = document.getElementById('mlsClunkyRoomsCss');
        const read = () => Math.round(x.getBoundingClientRect().left - pr.getBoundingClientRect().right);
        const on = read();
        let off = on;
        if (css) { css.disabled = true; off = read(); css.disabled = false; }
        return { label: (pr.textContent || '').trim(), gapOn: on, gapOff: off };
      })();
      try { SU_STEP = 5; suShow(); } catch (e) {}
      await sleep(800);
      out.step5 = (function () {
        const b = document.getElementById('su_step5');
        if (!b) return null;
        const clipped = Array.prototype.slice.call(b.querySelectorAll('*'))
          .filter((n) => C.visible(n) && n.scrollHeight > n.clientHeight + 8).length;
        const fold = document.getElementById('su_guideFold');
        return { shown: C.shown('#su_step5'), clipped: clipped,
          fold: !!fold, foldOpen: fold ? fold.open : null,
          openWords: (function () {
            /* what is on screen with the fold shut */
            const clone = b.cloneNode(true);
            const f = clone.querySelector('#su_guideFold');
            if (f) f.remove();
            return (clone.textContent || '').trim().split(/\s+/).filter(Boolean).length;
          })(),
          keepsAll: /Answers are specific to this app/.test(b.textContent || '') };
      })();
      try { closeSetup(); } catch (e) {}
      await sleep(400);
      /* 78: one statement about updating, and it is the true one */
      try { openSettings(); } catch (e) {}
      await sleep(1400);
      const tabs = Array.prototype.slice.call(document.querySelectorAll('#settingsTabBar .set-tab'));
      for (const t of tabs) { if (/Integrations/.test(t.textContent || '')) { t.click(); break; } }
      await sleep(1200);
      out.upd = (function () {
        const shown = Array.prototype.slice.call(document.querySelectorAll('#settingsModal .set-section'))
          .filter(C.visible).map((s) => s.innerText || '').join(' ');
        return { auto: /Updates are automatic/i.test(shown), manual: /four (setup )?steps over the old folder/i.test(shown) };
      })();
      try { closeSettings(); } catch (e) {}
      await sleep(400);
      return out;
    });
    measured.rooms = { rows: rooms.rows, recVisible: rooms.recVisible, aiStudio: rooms.aiStudio,
      recs: rooms.recs, wiz: rooms.wiz, step5: rooms.step5, upd: rooms.upd };
    ok(rooms.rows >= 20, 'the patient list did not render, so nothing below was measured');
    ok(rooms.recVisible <= 1,
      `${rooms.recVisible} of ${rooms.rows} rows carry a visible Record button (CLUNKY 124)`);
    ok(rooms.activeRowKeeps !== false,
      'the chosen row lost its Record button too - the control was removed, not moved (CLUNKY 124)');
    ok(rooms.pickOnFocus === false && rooms.pickOneChar === false && rooms.pickCleared === false,
      `the pulled-patient picker still drops over the roster on focus (${rooms.pickOnFocus}) / one character (${rooms.pickOneChar}) / after clearing (${rooms.pickCleared}) (CLUNKY 67)`);
    ok(rooms.pickTwoChars === true,
      'the picker no longer opens at all - gating it must not delete it (CLUNKY 67 guard)');
    eq(rooms.aiStudio, 1, `"AI Studio" is written ${rooms.aiStudio} times on the Studio screen (CLUNKY 142)`);
    ok(rooms.recs && rooms.recs.lit === 1,
      `Recommendations shows ${rooms.recs && rooms.recs.n} tabs with ${rooms.recs && rooms.recs.lit} lit (CLUNKY 130)`);
    ok(rooms.recs && rooms.recs.labels.indexOf('Recommendations') >= 0,
      'the lit segment on Recommendations is not the one that names it (CLUNKY 130)');
    ok(rooms.recsLeft && rooms.recsLeft.mine === 0 && rooms.recsLeft.lit === 1,
      'the Recommendations segment stayed behind on another screen (CLUNKY 130)');
    ok(rooms.wiz && rooms.wiz.gapOn >= 12,
      `the wizard × sits ${rooms.wiz && rooms.wiz.gapOn}px from the step label "${rooms.wiz && rooms.wiz.label}" (CLUNKY 114)`);
    ok(rooms.wiz && rooms.wiz.gapOn > rooms.wiz.gapOff,
      `the gap is not this block's doing: ${rooms.wiz && rooms.wiz.gapOff}px without its stylesheet, ${rooms.wiz && rooms.wiz.gapOn}px with it (CLUNKY 114)`);
    ok(rooms.step5 && rooms.step5.clipped === 0,
      `the last wizard screen still cuts ${rooms.step5 && rooms.step5.clipped} box(es) off mid-sentence (CLUNKY 115)`);
    ok(rooms.step5 && rooms.step5.fold && rooms.step5.foldOpen === false && rooms.step5.openWords <= 60,
      `the last wizard screen opens with ${rooms.step5 && rooms.step5.openWords} words and fold=${rooms.step5 && rooms.step5.foldOpen} (CLUNKY 115)`);
    ok(rooms.step5 && rooms.step5.keepsAll,
      'the quick guide was shortened by DELETION - every original line must survive behind the fold (CLUNKY 115 guard)');
    ok(!rooms.upd.auto && rooms.upd.manual,
      `Settings still carries both update stories (automatic:${rooms.upd.auto}, manual:${rooms.upd.manual}) (CLUNKY 78)`);

    await page.close();

    /* ------------------------------------------------------------ 390x844 */
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(page, port);
    await page.evaluate(() => window.__clunky.nav('nav_patients'));
    await page.waitForTimeout(700);

    /* The phone header must still fit: the chip took its room from the title,
       not from the page. A legibility fix that creates a horizontal scrollbar
       is the next defect, not a fix. */
    const narrow = await page.evaluate(() => ({
      hit: window.__clunky.coveredBy('#mslChipBtn'),
      chip: window.__clunky.rect('#mslChip'),
      today: window.__clunky.shown('#mslToday'),
      newBtnHit: window.__clunky.coveredBy('#mlsRdNewBtn'),
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rowOverflow: (function () { const t = document.getElementById('mlsRdTop'); return t ? t.scrollWidth - t.clientWidth : 0; })()
    }));
    measured.phoneHeader = narrow;
    eq(narrow.hit && narrow.hit[0], 'self', `phone: the mode chip is covered by ${narrow.hit && narrow.hit[0]} (CLUNKY 6)`);
    eq(narrow.newBtnHit && narrow.newBtnHit[0], 'self',
      'phone: the chips now cover the header + New button - the fix moved the collision (CLUNKY 6)');
    ok(!narrow.today, 'phone: the date chip did not stand down, so the header row has no slack (CLUNKY 6)');
    ok(narrow.docOverflow <= 0, `phone: the document scrolls sideways by ${narrow.docOverflow}px after the header change`);
    ok(narrow.rowOverflow <= 1, `phone: #mlsRdTop overflows by ${narrow.rowOverflow}px after the header change`);

    /* ================== caldata-1.0.0 at 390x844: CLUNKY 36 and 37 ===== */
    /* MEASURED at HEAD on this viewport with the same seeded month:
     *   #calGrid   301px wide, day cells 36px, 105 chips at clientWidth 20px
     *              reading "8..", "9..", "+7 m... ->" - nothing legible and
     *              nothing reliably tappable
     *   tap a day  #calDayPanel top = 1754px in an 844px viewport,
     *              position:static, window.scrollY unchanged: the only
     *              feedback a tap gives is the cell outline
     * At 390px a chip cannot be made readable, so the month becomes what it
     * can be - a picker with the day number and the count badge the renderer
     * already draws - and the tap it invites now lands somewhere visible. */
    const calPhone = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      C.nav('nav_calendar'); await sleep(1600);
      const seeded = await C.seedCalendarMonth();
      window.calSetMode('month'); await sleep(900);
      const grid = document.getElementById('calGrid');
      const cell = grid ? grid.querySelector(':scope > div > div[onclick^="calOpenDay"]') : null;
      const out = {
        seeded: seeded.count,
        chips: C.calChips().length,
        gridH: grid ? Math.round(grid.getBoundingClientRect().height) : null,
        cellH: cell ? Math.round(cell.getBoundingClientRect().height) : null,
        badges: grid ? grid.querySelectorAll('span[style*="border-radius:999px"]').length : 0
      };
      const y0 = window.scrollY;
      window.calOpenDay('2026-08-17');
      await sleep(1400);
      const p = document.getElementById('calDayPanel');
      const r = p ? p.getBoundingClientRect() : null;
      out.panelShown = C.shown('#calDayPanel');
      out.panelTop = r ? Math.round(r.top) : null;
      out.scrolled = window.scrollY !== y0;
      out.vh = window.innerHeight;
      return out;
    });
    measured.calPhone = calPhone;
    ok(calPhone.seeded > 100,
      `phone: only ${calPhone.seeded} appointments were applied - the CLUNKY 36/37 checks would pass vacuously`);
    eq(calPhone.chips, 0,
      `phone: the month still draws ${calPhone.chips} appointment chips at this width, where they measured 20px wide and read "8.." (CLUNKY 36)`);
    ok(calPhone.cellH >= 44,
      `phone: a month day cell is ${calPhone.cellH}px tall - below the 44px a thumb needs, and it is now the only target in the cell (CLUNKY 36)`);
    ok(calPhone.panelShown && calPhone.panelTop !== null && calPhone.panelTop < calPhone.vh,
      `phone: tapping a day left #calDayPanel at top ${calPhone.panelTop}px in a ${calPhone.vh}px viewport (shown ${calPhone.panelShown}, scrolled ${calPhone.scrolled}) - the tap still has no visible answer (CLUNKY 37)`);

    /* ============================ clunky2, at 390x844 ================== */
    /* MEASURED at HEAD on this viewport:
     *   .pt-item        188px tall, five lines, a full-width Record button
     *   Copilot header  a 139px column inside a 390px screen; "MLS Copilot"
     *                   on two lines; the phone QR card on the Studio screen
     *   .pp-row         a three-cell nowrap flex row in a 200px scroller
     */
    const ph2 = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const C = window.__clunky;
      const out = {};
      C.nav('nav_patients');
      await sleep(1400);
      /* 68: a DIFFERENTIAL, so the number is this block's doing and not the
         day's. Same page, same rows, stylesheet on and off. */
      const css = document.getElementById('mlsClunkyRoomsCss');
      const rowH = () => { const q = document.querySelectorAll('#ptList .pt-item'); return q.length ? Math.round(q[0].getBoundingClientRect().height) : null; };
      out.rowOn = rowH();
      if (css) { css.disabled = true; await sleep(500); out.rowOff = rowH(); css.disabled = false; await sleep(400); }
      out.rowCount = document.querySelectorAll('#ptList .pt-item').length;
      out.rec = (function () {
        const b = Array.prototype.slice.call(document.querySelectorAll('#ptList .pt-item button'))
          .filter((x) => /record/i.test(x.textContent || ''))[0];
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), name: (b.textContent || '').trim(), vis: getComputedStyle(b).visibility };
      })();
      /* a phone has no hover: Record must NOT be visibility:hidden here */
      out.spill = Array.prototype.slice.call(document.querySelectorAll('#ptList .pt-item')).slice(0, 8)
        .filter((it) => { const m = it.querySelector('.pt-main'); return m && m.scrollHeight > it.clientHeight + 2; }).length;
      /* 19 */
      C.nav('nav_studio');
      await sleep(1700);
      out.studio = (function () {
        const h2 = Array.prototype.slice.call(document.querySelectorAll('#studioView h2')).filter(C.visible)[0];
        if (!h2) return null;
        const r = h2.getBoundingClientRect();
        const hero = document.querySelector('#studioView #copilotHero > div');
        return { titleW: Math.round(r.width), titleH: Math.round(r.height),
          dir: hero ? getComputedStyle(hero).flexDirection : null,
          phoneCard: C.shown('#mlsGetPhoneCard'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })();
      /* 129 */
      const rows = [];
      for (let i = 0; i < 9; i++) rows.push({ k: 'k' + i, name: 'Syn ' + i, ok: i < 6, done: true,
        reason: i < 6 ? '' : 'read-failed', dn: i === 1 ? 'retrying:slow' : '' });
      window.__mlsDayHistoryPull = { state: { running: true, total: 23, done: 9, ok: 6, failed: 3,
        chartOnly: 0, current: 'Syn 0', rows: rows } };
      await sleep(1400);
      const fab = document.getElementById('mlsPullProgFab');
      if (fab) fab.click();
      await sleep(1400);
      const p = document.getElementById('mlsPullProgPanel');
      out.pull = p ? {
        rowDisplay: (function () { const r = p.querySelector('.pp-row'); return r ? getComputedStyle(r).display : null; })(),
        rowsMax: (function () { const r = p.querySelector('.pp-rows'); return r ? getComputedStyle(r).maxHeight : null; })(),
        rowCells: (function () { const r = p.querySelector('.pp-row'); return r ? r.children.length : 0; })(),
        stop: (function () { const s = document.getElementById('mlsPullProgStop'); return s ? getComputedStyle(s).color : null; })()
      } : null;
      try { window.__mlsDayHistoryPull = { state: null }; } catch (e) {}
      await sleep(1100);
      return out;
    });
    measured.phone2 = ph2;
    ok(ph2.rowCount >= 20, 'phone: the patient list did not render, so nothing below was measured');
    ok(ph2.rowOn && ph2.rowOn <= 100,
      `phone: a patient row is ${ph2.rowOn}px tall - a third of the screen per patient (CLUNKY 68)`);
    ok(ph2.rowOff && ph2.rowOff > ph2.rowOn,
      `phone: the row height is not this block's doing - ${ph2.rowOff}px without its stylesheet, ${ph2.rowOn}px with it (CLUNKY 68)`);
    eq(ph2.spill, 0, `phone: ${ph2.spill} rows now spill their content outside the row box (CLUNKY 68 guard)`);
    ok(ph2.rec && ph2.rec.vis !== 'hidden',
      'phone: Record is visibility:hidden where there is no hover to bring it back (CLUNKY 124 guard)');
    ok(ph2.rec && ph2.rec.w <= 56 && ph2.rec.h >= 40,
      `phone: the Record control is ${ph2.rec && ph2.rec.w}x${ph2.rec && ph2.rec.h} - it must be a 44px target, not a slab (CLUNKY 68)`);
    ok(ph2.rec && /Record/.test(ph2.rec.name),
      'phone: the Record button lost its accessible name when it became an icon (CLUNKY 68 guard)');
    ok(ph2.studio && ph2.studio.dir === 'column',
      `phone: the Copilot header is still a ${ph2.studio && ph2.studio.dir} row, so the title gets what is left (CLUNKY 19)`);
    ok(ph2.studio && ph2.studio.titleW >= 240,
      `phone: the Copilot title has ${ph2.studio && ph2.studio.titleW}px of a 390px screen (CLUNKY 19)`);
    ok(ph2.studio && !ph2.studio.phoneCard,
      'phone: the "Use MLS on your phone" QR card is still on the Studio screen, on a phone (CLUNKY 19)');
    ok(ph2.studio && ph2.studio.overflow <= 0,
      `phone: the document scrolls sideways by ${ph2.studio && ph2.studio.overflow}px after the Studio change`);
    ok(ph2.pull && ph2.pull.rowDisplay === 'block',
      `phone: a pull row is still a ${ph2.pull && ph2.pull.rowDisplay} fighting for one line (CLUNKY 129)`);
    ok(ph2.pull && parseFloat(ph2.pull.rowsMax) > 200,
      `phone: the pull row list is still capped at ${ph2.pull && ph2.pull.rowsMax} (CLUNKY 129)`);
    ok(ph2.pull && ph2.pull.rowCells >= 2,
      'phone: the pull row lost cells - stacking must not delete the verdict (CLUNKY 129 guard)');
    await page.close();

    ok(pageErrors.length === 0, 'the page threw: ' + pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`1p-clunky-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-clunky-contract FAILED: ' + (e && e.message));
  process.exit(1);
});
