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
  'clunky-calendar-1.0.0'
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
    nav: function (id) { try { var b = document.getElementById(id); if (b) b.click(); } catch (e) {} }
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
        })()
      };
    });
    measured.calendar = cal;
    ok(!cal.cardShown,
      `the 250px "DAY AT A GLANCE" card is back on the calendar (${cal.cardHeight}px) alongside the colour legend (CLUNKY 112)`);
    ok(cal.lineShown && /booked/.test(cal.line || ''),
      `the day's numbers went away with the card instead of moving to one line (got "${cal.line}") (CLUNKY 112)`);
    ok(cal.gridW && cal.gridW.on >= cal.gridW.off - 2,
      `this block's stylesheet NARROWS #calGrid: ${cal.gridW.off}px without it, ${cal.gridW.on}px with it - a crowding fix that spends its clearance somewhere invisible (CLUNKY 34 guard)`);
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
