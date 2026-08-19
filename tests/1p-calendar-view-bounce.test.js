'use strict';

/* /1p — "THE CALENDAR IS BROKEN": THE VIEW-BOUNCE, ROOT-CAUSED.
 *
 * THE REPORT (owner, 2026-08-18): opening the Calendar threw the screen back to
 * the Visit view a few seconds later. It was measured live once and then would
 * not reproduce, so it was carried as a possible probe artifact.
 *
 * THE CAUSE, MEASURED (local harness, no login, no PHI). The session tab-memory
 * in 1p-mls-connect.js restores the remembered tab 800ms after the load event.
 * Its only guard was `saved !== currentView()` — which is TRUE in exactly the
 * case where the doctor has just navigated somewhere else. Before this suite:
 *
 *   saved=visit, a click that put .navtab.on=calendar at +1096ms
 *   -> showView('visit') at +1298ms, 202ms later, and Visit stayed for the
 *      remaining 3s of the trace.        (3 of 3 runs; scratch p6)
 *
 * On a real signed-in boot the load event lands much later than in the harness,
 * which is why the owner saw it about three seconds in.
 *
 * THE FIX has two named parts, and this suite pins BOTH, plus the thing they
 * must not break — the restore itself:
 *   navgesture-1.0.0        (both shells) a parse-time, capture-phase, passive
 *                           listener that records ONE timestamp the first time
 *                           a trusted press or keystroke reaches the document.
 *                           It must be armed before 1p-mls-connect.js loads,
 *                           because that file is far too late to see a press
 *                           made during boot.
 *   tabmem-standdown-1.0.0  (1p-mls-connect.js) restore() stands down when a
 *                           human has acted, or when the active tab moved on
 *                           its own between arming and restoring.
 *
 * PART 1 is static. PART 2 drives both real shells in real headless Chrome.
 *
 * THE TRAP THIS SUITE INHERITS: 1p-mls-connect.js is not loaded by the page on
 * its own. Without window.__mlsEnsureUiBundle() there is no window.__mlsTabMemory
 * at all and every assertion below passes vacuously — so the runtime part waits
 * for it and fails if it never appears.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const MC = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ======================================================== PART 1: static */

for (const rel of SHELLS) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const a = src.indexOf('<!-- ===== navgesture-1.0.0');
  const b = src.indexOf('<!-- ===== end navgesture-1.0.0');
  ok(a >= 0, `${rel}: the navgesture-1.0.0 block is missing`);
  ok(b > a, `${rel}: the navgesture-1.0.0 block is unclosed or closes before it opens`);
  const block = src.slice(a, b);
  ok(/__mlsUserActed\b/.test(block), `${rel}: navgesture does not set window.__mlsUserActed`);
  ok(/isTrusted/.test(block), `${rel}: navgesture does not require a TRUSTED event — a synthetic click from any module would silence the tab memory`);
  ok(/capture:\s*true/.test(block), `${rel}: navgesture does not listen in the capture phase, so a stopPropagation anywhere hides the press`);
  ok(/passive:\s*true/.test(block), `${rel}: navgesture is not passive — a boot-time listener must never be able to delay a scroll or a tap`);
  for (const t of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) {
    ok(block.indexOf("'" + t + "'") > 0, `${rel}: navgesture does not listen for ${t}`);
  }
  /* IT MUST BE EARLY. The whole point is to be armed before a doctor can press
     anything; if it lands after the UI bundle it adds nothing the tab memory
     could not have measured itself. */
  const bundle = src.indexOf('mls-connect.js');
  ok(bundle < 0 || a < bundle,
    `${rel}: navgesture-1.0.0 is mounted AFTER the connect bundle (${a} vs ${bundle}) — a press during boot would not be seen`);
  /* And it must not do anything else. One assignment, no routing, no render. */
  ok(!/showView|renderCalendar|loadCalendar|location\s*=/.test(block),
    `${rel}: navgesture-1.0.0 does more than record a timestamp`);
}

/* the twins carry the SAME block, byte for byte */
{
  const cut = (rel) => {
    const s = fs.readFileSync(path.join(root, rel), 'utf8');
    return s.slice(s.indexOf('<!-- ===== navgesture-1.0.0'), s.indexOf('<!-- ===== end navgesture-1.0.0'));
  };
  eq(cut(SHELLS[0]), cut(SHELLS[1]), 'the two shells carry different navgesture-1.0.0 blocks');
}

/* the stand-down itself */
{
  const a = MC.indexOf('/* ===== tabmem-standdown-1.0.0');
  const b = MC.indexOf('/* ===== end tabmem-standdown-1.0.0');
  ok(a >= 0, '1p-mls-connect.js: the tabmem-standdown-1.0.0 block is missing');
  ok(b > a, '1p-mls-connect.js: the tabmem-standdown-1.0.0 block is unclosed');
  const block = MC.slice(a, b);
  ok(/function standDownReason\(\)/.test(block), 'the stand-down has no single place that says why it stood down');
  ok(/__mlsUserActed/.test(block), 'the stand-down never reads the shell’s gesture flag');
  ok(/armView/.test(block), 'the stand-down never compares the view it armed on');
  /* THE GUARD MUST BE ON THE RESTORE, not merely computed. The first shape of
     this fix computed a reason and then restored anyway. */
  ok(/if\s*\(\s*!standDown\s*&&\s*saved\s*&&/.test(block),
    'restore() does not consult the stand-down before routing');
  /* the recorder still starts either way, or the doctor’s chosen tab is never saved */
  ok(/setTimeout\(startRecording,\s*standDown \? 0 : 200\)/.test(block),
    'a stood-down restore no longer starts the recorder, so the tab the doctor chose is never remembered');
}

/* ==================================================== PART 2: runtime */

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.map': 'application/json' };

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

/* One boot, one scenario. `saved` is the remembered tab; `act` is what happens
   inside the restore window: 'gesture' is a real trusted mouse press, 'route'
   is a programmatic navigation, null is nothing at all. */
async function scenario(browser, port, shell, saved, act) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.addInitScript((tab) => {
    try { if (tab) sessionStorage.setItem('mlsLastTab', tab); else sessionStorage.removeItem('mlsLastTab'); } catch (e) {}
    window.__T0 = Date.now();
    window.__trace = [];
  }, saved);
  await page.goto(`http://127.0.0.1:${port}/${shell.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: 90000 });
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    /* the tab memory's own reading of "where am I", reproduced exactly */
    window.__cv = () => {
      const el = document.querySelector('.navtab.on'); if (!el) return '';
      const m = (el.getAttribute('onclick') || '').match(/showView\(\s*['"]([a-z]+)['"]\s*\)/i);
      return m ? m[1] : '';
    };
    setInterval(() => { window.__trace.push({ ms: Date.now() - window.__T0, cv: window.__cv() }); }, 60);
  });
  await page.evaluate(() => { if (typeof window.__mlsEnsureUiBundle === 'function') window.__mlsEnsureUiBundle(); });
  /* NOT VACUOUS: without the bundle there is no tab memory and nothing below means anything. */
  await page.waitForFunction(() => !!window.__mlsTabMemory, null, { timeout: 60000 });

  if (act) {
    await page.waitForTimeout(180);
    if (act === 'gesture') await page.mouse.click(683, 450);
    else if (act === 'route') await page.evaluate(() => { const b = document.getElementById('nav_calendar'); if (b) b.click(); else window.showView('calendar'); });
  }
  await page.waitForTimeout(3200);
  const out = await page.evaluate(() => ({
    final: window.__cv(),
    acted: !!window.__mlsUserActed,
    armed: !!window.__mlsUserActedArmed,
    armView: window.__mlsTabMemory._armView(),
    standDown: window.__mlsTabMemory._standDown(),
    seen: (function () { const o = []; window.__trace.forEach((t) => { if (!o.length || o[o.length - 1] !== t.cv) o.push(t.cv); }); return o; })()
  }));
  await page.close();
  return out;
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const shell of SHELLS) {
      const tag = shell.replace(/\\/g, '/');

      /* --- THE FEATURE STILL WORKS. This is the control, and it comes first:
         a stand-down that never stands up has simply deleted the feature. --- */
      const restored = await scenario(browser, port, shell, 'calendar', null);
      measured[tag + ':restore'] = restored;
      eq(restored.standDown, '', `${tag}: the tab memory stood down with nothing happening — ${restored.standDown}`);
      eq(restored.final, 'calendar', `${tag}: the remembered tab was NOT restored (ended on "${restored.final}") — the fix deleted the feature`);
      ok(restored.seen.indexOf(restored.armView) === 0 && restored.seen.indexOf('calendar') > 0,
        `${tag}: the restore did not move the view; trace was ${JSON.stringify(restored.seen)}`);

      /* the flag is armed on a page nobody has touched, and reads false */
      ok(restored.armed, `${tag}: navgesture-1.0.0 never armed`);
      eq(restored.acted, false, `${tag}: __mlsUserActed is set on a page nobody pressed — the flag is not trustworthy`);

      /* --- THE DEFECT: a trusted press inside the restore window wins. --- */
      const pressed = await scenario(browser, port, shell, 'visit', 'gesture');
      measured[tag + ':gesture'] = pressed;
      eq(pressed.acted, true, `${tag}: a real mouse press did not set __mlsUserActed`);
      ok(/doctor has already used/.test(pressed.standDown),
        `${tag}: the restore did not stand down for a real press (reason: "${pressed.standDown}")`);
      ok(pressed.seen.indexOf('visit') < 0,
        `${tag}: THE VIEW-BOUNCE IS BACK — the doctor pressed, and the remembered tab took the screen anyway; trace ${JSON.stringify(pressed.seen)}`);

      /* --- and a route that moved on its own is left alone too (a deep link,
         datalink's post-pull focusCalDay). --- */
      const routed = await scenario(browser, port, shell, 'visit', 'route');
      measured[tag + ':route'] = routed;
      eq(routed.final, 'calendar', `${tag}: a programmatic route into the Calendar was overwritten by the remembered tab`);
      ok(/moved to calendar/.test(routed.standDown),
        `${tag}: the restore did not stand down for a view that moved on its own (reason: "${routed.standDown}")`);
    }
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(JSON.stringify(measured, null, 2));
  console.log(`1p-calendar-view-bounce: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-calendar-view-bounce FAILED:', e && e.message);
  process.exit(1);
});
