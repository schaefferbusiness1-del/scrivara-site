'use strict';

/* rowclick-1.0.0  --  a patient row owns every pixel of itself
 * ==========================================================================
 * OWNER-LEVEL SYMPTOM, measured on live b1230 walking the app as a first-day
 * doctor: on the Patients screen, two presses at the TOP of a patient row did
 * nothing - and one of them rewrote the search box with a DIFFERENT patient's
 * name. Only the lower half of the row selected the patient.
 *
 * MEASURED CAUSE, reproduced here at 1366x900 with eight synthetic patients:
 * the quick patient picker (#mls-pick-dd, feat_patient_picker) opened as an
 * ABSOLUTE 1120x320 panel hanging off the search row, directly over the top of
 * #ptList. document.elementFromPoint over the first row's top third resolved to
 * .mls-pick-row - and .mls-pick-row's mousedown calls choose(), which writes
 * THAT person's name into #ptSearch. That is the reported symptom exactly.
 *
 * Note what the cure could NOT be. The panel is not a hint; it is a list a
 * doctor picks from, so pointer-events:none would only move the dead zone
 * somewhere else. It is given its OWN space instead - a normal block between
 * the search row and the list - so it is never over a row and every pixel of
 * every row belongs to that row. Closed, it is display:none and costs nothing.
 *
 * CLUNKY 67 still stands and is re-asserted here from the other side: gating
 * the panel must never DELETE it. It still opens on the second typed character.
 *
 * Run: node tests/patient-row-owns-its-clicks-runtime.test.js
 * (bundled Playwright: NODE_PATH=<a worktree with node_modules>)
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

/* Injected. Synthetic names only - no PHI ever reaches this file. */
function seedPatients() {
  const NAMES = ['Sample Ada', 'Sample Bo', 'Sample Cy', 'Sample Dee',
    'Sample Eli', 'Sample Fay', 'Sample Gus', 'Sample Hal'];
  const DAY = '2026-09-11';
  try {
    savePatients(NAMES.map((n, i) => ({
      id: 'syn-' + i, name: n, dob: '19' + (60 + i) + '-01-0' + ((i % 9) + 1),
      mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: []
    })));
  } catch (e) { return 'ERR ' + (e && e.message); }
  window._calAppts = NAMES.map((n, i) => ({
    id: 'appt-' + i, name: n, patient_external_id: 'syn-' + i, patientId: 'syn-' + i,
    appt_date: DAY, start_at: DAY + 'T08:00:00', reason: 'Follow-up',
    providerName: 'Sample Provider, MD'
  }));
  try { renderPatients(); } catch (e) {}
  try { showView('patients'); } catch (e) {}
  return 'ok';
}

/* THE MEASUREMENT. For every patient row that is really on the screen, the
   element under the top third of that row must belong to that row. Rows below
   the fold are reported separately and never counted as passes - a hit-test
   outside the viewport returns null and would otherwise read as "clean". */
function measureRows() {
  const rows = Array.prototype.slice.call(document.querySelectorAll('#ptList .pt-item'));
  const dd = document.getElementById('mls-pick-dd');
  const ddShown = !!(dd && getComputedStyle(dd).display !== 'none' &&
    dd.getBoundingClientRect().width > 0 && dd.getBoundingClientRect().height > 0);
  const ddRect = dd ? dd.getBoundingClientRect() : null;
  const vh = window.innerHeight;
  const out = { rows: rows.length, onScreen: 0, stolen: [], overlaps: 0, ddShown: ddShown, ddText: '' };
  if (dd) out.ddText = String(dd.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  rows.forEach((row, i) => {
    const r = row.getBoundingClientRect();
    if (!(r.height > 0) || r.top < 0 || r.bottom > vh) return;
    out.onScreen++;
    if (ddShown && ddRect) {
      const ix = Math.max(0, Math.min(r.right, ddRect.right) - Math.max(r.left, ddRect.left));
      const iy = Math.max(0, Math.min(r.bottom, ddRect.bottom) - Math.max(r.top, ddRect.top));
      if (ix * iy > 0) out.overlaps++;
    }
    [0.08, 0.16, 0.25, 0.33].forEach((f) => {
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height * f);
      const hit = document.elementFromPoint(x, y);
      if (hit && row.contains(hit)) return;
      out.stolen.push({
        row: i, f: f, y: y,
        by: hit ? ((hit.id ? '#' + hit.id : '') + '.' + String(hit.className || '').split(/\s+/)[0]) : 'nothing'
      });
    });
  });
  return out;
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
    const seeded = await page.evaluate(seedPatients);
    eq(seeded, 'ok', 'the synthetic roster did not land: ' + seeded);
    await page.waitForTimeout(2500);

    /* ---- 1. the roster renders, and a quiet screen is already clean ---- */
    const quiet = await page.evaluate(measureRows);
    measured.rows = quiet.rows;
    ok(quiet.rows >= 8, `the patient list did not render (${quiet.rows} rows), so nothing below was measured`);
    ok(quiet.onScreen >= 1, 'no patient row was on screen, so nothing below was measured');
    assert.deepStrictEqual(quiet.stolen, [],
      'with nothing open, something already stands on a patient row: ' + JSON.stringify(quiet.stolen));
    checks++;

    /* ---- 2. with the picker OPEN, the rows still own their own pixels ---- */
    await page.click('#ptSearch');
    await page.type('#ptSearch', 'sam', { delay: 90 });
    await page.waitForTimeout(1200);
    const open = await page.evaluate(measureRows);
    measured.pickerRowsOnScreen = open.onScreen;
    measured.pickerOverlaps = open.overlaps;

    /* CLUNKY 67 from the other side: gating must never delete the picker. */
    ok(open.ddShown === true,
      'the pulled-patient picker no longer opens on the second typed character. ' +
      'Keeping it out of the rows must not delete it (CLUNKY 67 guard).');
    ok(/pick one/i.test(open.ddText), 'the open picker is not the pulled-patient list: ' + JSON.stringify(open.ddText));
    ok(open.onScreen >= 1, 'no patient row was on screen with the picker open, so nothing was measured');
    eq(open.overlaps, 0,
      `the picker panel is drawn over ${open.overlaps} patient row(s). It is opaque and clickable, ` +
      'so every row it covers is a row the doctor cannot press - and .mls-pick-row rewrites the ' +
      'search box with whichever name it was over.');
    assert.deepStrictEqual(open.stolen, [],
      'the top of a patient row is owned by something else while the picker is open: ' +
      JSON.stringify(open.stolen));
    checks++;

    /* ---- 3. POSITIVE CONTROL - the instrument can see the defect ----
       Put the panel back exactly where it was before this fix (absolute, hung
       under the search row) and the measurement above must FAIL. Without this,
       a passing run proves nothing about the instrument. */
    const control = await page.evaluate(() => {
      const dd = document.getElementById('mls-pick-dd');
      const row = document.getElementById('ptSearchRow');
      if (!dd || !row) return null;
      dd.__mlsPrevCss = dd.style.cssText;
      dd.__mlsPrevNext = dd.nextSibling;
      dd.__mlsPrevParent = dd.parentNode;
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
      row.appendChild(dd);
      dd.style.position = 'absolute';
      dd.style.left = '0';
      dd.style.right = '0';
      dd.style.top = 'calc(100% + 4px)';
      dd.style.margin = '0';
      dd.style.zIndex = '2147481000';
      return true;
    });
    ok(control === true, 'the positive control could not stage the pre-fix layout');
    await page.waitForTimeout(250);
    const broken = await page.evaluate(measureRows);
    ok(broken.stolen.length > 0 || broken.overlaps > 0,
      'THE INSTRUMENT IS BLIND: staged in its pre-fix absolute position the picker covered ' +
      'no row and stole no press, so the clean result above says nothing.');
    measured.controlStolen = broken.stolen.length;
    measured.controlOverlaps = broken.overlaps;

    /* put it back, and prove the restore really restored */
    await page.evaluate(() => {
      const dd = document.getElementById('mls-pick-dd');
      if (!dd) return;
      dd.style.cssText = dd.__mlsPrevCss || '';
      if (dd.__mlsPrevParent) dd.__mlsPrevParent.insertBefore(dd, dd.__mlsPrevNext || null);
    });
    await page.waitForTimeout(250);
    const restored = await page.evaluate(measureRows);
    assert.deepStrictEqual(restored.stolen, [],
      'the positive control did not restore the shipped layout: ' + JSON.stringify(restored.stolen));
    checks++;

    /* ---- 4. nothing threw while all of that happened ---- */
    assert.deepStrictEqual(pageErrors, [], 'the page threw while the roster was being measured');
    checks++;
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('PASS patient row owns its clicks: ' + checks + ' checks - ' + JSON.stringify(measured) +
    ' - with the pulled-patient picker open on the second typed character it is drawn in its own ' +
    'space between the search row and the list, overlaps zero patient rows, and every on-screen ' +
    'row still answers the hit-test across its own top third; staged back in its pre-fix absolute ' +
    'position the same measurement fails, so the clean result is real');
})().catch((err) => { console.error(err); process.exit(1); });
