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
  'clunky-header-1.0.0'
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

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
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
