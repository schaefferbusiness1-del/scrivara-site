'use strict';

/* reviewnote-1.1.0  --  "The note" really ends with the note on the screen
 * ==========================================================================
 * WHY THIS SUITE EXISTS AT ALL. The stub-DOM suite beside it (review-note-tab-
 * lands-on-the-note.test.js) proved that the block scrolls to whatever it
 * decides is the note. That is a PROXY. On the real shell, reviewnote-1.0.0
 * decided #ez3flNoteWrap was the note because it had width and height - and
 * #ez3flNoteWrap paints NO note: the bundle's own stylesheet hides its label,
 * its textarea and its formatted panel ("never render a second note/editor"),
 * so the only thing the browser draws inside it is the 90px "Next: Review &
 * send to Athena" row. Measured in headless Chrome at 1366x900: after the
 * press the note's words sat in #ez3Note at y890 of a 900px viewport, i.e.
 * still off the screen, while the module counted the press as a landing.
 *
 * So this suite asserts the DOCTOR-VISIBLE PROPERTY and nothing else:
 *
 *     after pressing "The note", the note's own words are inside the viewport.
 *
 * It measures that INDEPENDENTLY of the module - its own paint-aware text walk
 * (a display:none child paints nothing; a textarea paints its value), reduced
 * to MINIMAL carriers, because an ancestor that merely contains the note is
 * not the note on screen. And it carries two positive controls, because a
 * green run means nothing unless the instrument can see the defect:
 *
 *   A. the pre-fix SURFACE CHOICE - centre #ez3flNoteWrap, exactly what 1.0.0
 *      did - must leave the note off the screen;
 *   B. no landing at all must leave the note off the screen.
 *
 * Synthetic note text only; no PHI ever reaches this file.
 *
 * Run: NODE_PATH=<a worktree with node_modules> node \
 *        tests/review-note-tab-lands-on-the-note-runtime.test.js
 * ========================================================================*/

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.webp': 'image/webp'
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

/* Synthetic. Deliberately ordinary clinical English so the word runs below are
   the kind a real note would produce. */
const NOTE = [
  'SUBJECTIVE: Synthetic patient reports a mild sore throat for three days.',
  '',
  'OBJECTIVE: Temperature ninety eight point six degrees and lungs clear to auscultation.',
  '',
  'ASSESSMENT: Synthetic viral pharyngitis without complication.',
  '',
  'PLAN: Synthetic supportive care and follow up as needed.'
].join('\n');

/* ==========================================================================
 * THE MEASUREMENT - injected, and deliberately NOT the module's own idea of
 * where the note is. Elements that PAINT a run of the note's own consecutive
 * words, reduced to the minimal ones, each tested against the viewport.
 * ======================================================================== */
function measureNoteOnScreen(noteText) {
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* both sides reduced the same way, so a renderer that drops a joining word
     cannot make a run miss */
  function keyWords(s) { return norm(s).split(' ').filter((w) => w.length > 2); }
  const words = keyWords(noteText);
  const runs = [];
  for (let i = 0; i + 5 <= words.length && runs.length < 8; i += 5) runs.push(words.slice(i, i + 5).join(' '));
  function shown(n) {
    const cs = getComputedStyle(n), r = n.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }
  function painted(el, depth) {
    if (!el || depth > 14 || !shown(el)) return '';
    const tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return String(el.value || '');
    const parts = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3) parts.push(String(n.nodeValue || ''));
      else if (n.nodeType === 1) parts.push(painted(n, depth + 1));
    }
    return parts.join(' ');
  }
  const vh = window.innerHeight;
  const els = [];
  for (const el of document.querySelectorAll('*')) {
    const t = keyWords(painted(el, 0)).join(' ');
    if (!t || !runs.some((r) => t.indexOf(r) >= 0)) continue;
    els.push(el);
  }
  const minimal = els.filter((el) => !els.some((o) => o !== el && el.contains(o)));
  const carriers = minimal.map((el) => {
    const r = el.getBoundingClientRect();
    const band = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    return {
      sel: (el.id ? '#' + el.id : String(el.tagName).toLowerCase()) + '.' + String(el.className || '').split(/\s+/)[0],
      top: Math.round(r.top), h: Math.round(r.height),
      onScreen: band >= Math.min(r.height, 80)
    };
  });
  return {
    scrollY: Math.round(window.scrollY), vh, runs: runs.length,
    anyOnScreen: carriers.some((c) => c.onScreen), carriers: carriers
  };
}

async function goToReview(page) {
  await page.evaluate(() => { const o = document.getElementById('nav_orders'); if (o) o.click(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}
async function pressTheNote(page) {
  return page.evaluate(() => {
    const s = Array.prototype.slice.call(document.querySelectorAll('#mlsRightNow .segbtn'))
      .filter((b) => /^the note$/i.test(String(b.textContent || '').trim()))[0];
    if (!s) return 'no segment';
    s.click();
    return 'pressed';
  });
}

(async () => {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    /* WITHOUT THIS the page is a bare shell and every measurement is vacuous:
       1p-mls-connect.js rides a gate only a login normally opens. */
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
    });

    /* ---- 0. a synthetic patient with a note, and the visit room up ---- */
    const seeded = await page.evaluate((noteText) => {
      try {
        savePatients([{
          id: 'syn-0', name: 'Sample Ada', dob: '1970-01-01', mrn: 'MRN100000',
          athenaId: '900000', notes: [], visits: []
        }]);
      } catch (e) { return 'ERR save ' + (e && e.message); }
      try { selectPatient('syn-0'); } catch (e) { return 'ERR select ' + (e && e.message); }
      const nb = document.getElementById('noteBox');
      if (!nb) return 'ERR no noteBox';
      nb.value = noteText;
      try { nb.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      return 'ok';
    }, NOTE);
    eq(seeded, 'ok', 'the synthetic patient and note did not land: ' + seeded);
    await page.waitForTimeout(1200);
    const opened = await page.evaluate(() => {
      try { (window.__mlsEasyV3 || window.__mlsEasyV32).open('doctor'); return 'ok'; }
      catch (e) { return 'ERR ' + (e && e.message); }
    });
    eq(opened, 'ok', 'the guided visit room would not open: ' + opened);
    await page.waitForTimeout(2500);

    const version = await page.evaluate(() => (window.__mlsReviewNoteLanding || {}).version || '');
    ok(/^reviewnote-/.test(version), 'the landing block is not installed on the real shell (version ' + JSON.stringify(version) + ')');
    measured.version = version;

    /* ---- 1. the Review screen really is a screen with no note on it ---- */
    await goToReview(page);
    const segments = await page.evaluate(() => Array.prototype.slice
      .call(document.querySelectorAll('#mlsRightNow .segbtn'))
      .map((s) => String(s.textContent || '').replace(/\s+/g, ' ').trim()));
    ok(segments.some((s) => /^the note$/i.test(s)),
      'the Review dock no longer offers a segment labelled "The note" - this suite answers to that ' +
      'exact label, so it must exist: ' + JSON.stringify(segments));
    const onReview = await page.evaluate(measureNoteOnScreen, NOTE);
    ok(onReview.runs >= 4, 'the synthetic note produced too few word runs to measure with');
    eq(onReview.anyOnScreen, false,
      'the Review screen already shows the note, so pressing "The note" proves nothing here: ' +
      JSON.stringify(onReview.carriers));

    /* ---- 2. THE PROPERTY: the press ends with the note on the screen ---- */
    eq(await pressTheNote(page), 'pressed', 'the "The note" segment could not be pressed');
    await page.waitForTimeout(4000);
    const shipped = await page.evaluate(measureNoteOnScreen, NOTE);
    measured.shipped = shipped.carriers;
    ok(shipped.carriers.length >= 1,
      'after the press nothing on the page paints the note at all - the room came up without it');
    eq(shipped.anyOnScreen, true,
      'THE TAB IS STILL NOT TRUE: pressing "The note" left every copy of the note outside the ' +
      'viewport. Carriers: ' + JSON.stringify(shipped.carriers) + ' at scrollY ' + shipped.scrollY);

    /* the block must not claim a landing it did not deliver, and the surface it
       chose must be one that really paints the note */
    const claim = await page.evaluate(() => ({
      counts: window.__mlsReviewNoteLanding.counts(),
      shows: window.__mlsReviewNoteLanding.showsNote()
    }));
    measured.surface = claim.shows.surface;
    eq(claim.counts.lands >= 1, true, 'the block did not record the landing it just made');
    eq(claim.shows.onScreen, true, 'the block reports its own surface off screen while claiming a landing');
    ok(shipped.carriers.some((c) => c.onScreen && c.sel.split('.')[0] === claim.shows.surface),
      'the block landed on ' + JSON.stringify(claim.shows.surface) + ', which is not one of the ' +
      'elements independently measured to be painting the note on screen: ' + JSON.stringify(shipped.carriers));

    /* ---- 3. POSITIVE CONTROL A - the pre-fix surface choice must FAIL ----
       Take the landing out, press again, then do exactly what reviewnote-1.0.0
       did: centre #ez3flNoteWrap. If the note is on screen after that, this
       whole measurement is blind. */
    await page.evaluate(() => window.__mlsReviewNoteLanding.revert());
    await goToReview(page);
    await pressTheNote(page);
    await page.waitForTimeout(1400);
    const staged = await page.evaluate(() => {
      const w = document.getElementById('ez3flNoteWrap');
      if (!w) return 'no wrap';
      w.scrollIntoView({ block: 'center', behavior: 'auto' });
      return 'staged';
    });
    eq(staged, 'staged', 'the positive control could not stage the pre-fix landing: ' + staged);
    await page.waitForTimeout(700);
    const controlA = await page.evaluate(measureNoteOnScreen, NOTE);
    measured.controlA = controlA.carriers;
    eq(controlA.anyOnScreen, false,
      'THE INSTRUMENT IS BLIND: centring #ez3flNoteWrap - the pre-fix landing - put the note on ' +
      'screen by itself, so the pass above says nothing: ' + JSON.stringify(controlA.carriers));

    /* ---- 4. POSITIVE CONTROL B - no landing at all must FAIL ---- */
    await goToReview(page);
    await pressTheNote(page);
    await page.waitForTimeout(3000);
    const controlB = await page.evaluate(measureNoteOnScreen, NOTE);
    measured.controlB = controlB.carriers;
    eq(controlB.anyOnScreen, false,
      'THE INSTRUMENT IS BLIND: with the landing reverted the press already ended on the note, so ' +
      'the block is not what puts it there: ' + JSON.stringify(controlB.carriers));

    /* ---- 5. nothing threw while all of that happened ---- */
    assert.deepStrictEqual(pageErrors, [], 'the page threw while the landing was being measured');
    checks++;
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('PASS review note tab lands on the note (runtime): ' + checks + ' checks - ' +
    JSON.stringify(measured) + ' - on the real shell the Review screen shows no note, and pressing ' +
    '"The note" ends with the note\'s own words inside the viewport, measured independently of the ' +
    'block; staged back at the pre-fix surface, and with no landing at all, the same measurement ' +
    'fails, so the pass is real');
})().catch((err) => { console.error(err); process.exit(1); });
