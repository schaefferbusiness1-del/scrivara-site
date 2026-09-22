'use strict';

/* A visit that needs no op note is not an unfinished op note.
 *
 * Measured on the live ScribeFlow.html sample day (four clinic visits, no
 * procedures): the op-note room said "4 patients · 4 to finish", every row read
 * "Not drafted", and the day's primary was "Review 4 notes" - while the panel
 * beside it said there was nothing to draft. Held rows (not a procedure,
 * cancelled, no-show, never seen) were folded into the 'review' state.
 *
 * And a real click on Draft all reached the runner through its capture
 * listener, bypassing the day-brain wrapper that passed the skip list, so a
 * routine follow-up on a procedure day was drafted, refused by the per-row
 * gate, and reported as "failed - the note service gave no reason".
 *
 * Real Chrome against /ScribeFlow.html (the production shell). */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'offline' }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/ScribeFlow.html?preview=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.openOpPrep === 'function' && !!window.__mlsOpDay && (window._calAppts || []).length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(1500);

    /* 1. the sample day: four visits, none a procedure */
    await page.evaluate(() => window.openOpPrep());
    await page.waitForFunction(() => { const t = window.__mlsOpDay.tally(); return t && t.n > 0 && t.held === t.n; }, null, { timeout: 30000 });
    /* the rail repaints on its own coalesced tick after triage lands */
    await page.waitForFunction(() => /no op note needed/.test((document.getElementById('mlsOpDayCount') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const sample = await page.evaluate(() => ({
      tally: window.__mlsOpDay.tally(), day: window.__mlsOpDay.dayState(),
      go: (() => { const g = document.getElementById('mlsOpDayGo'); return g ? { hidden: g.hidden, text: g.textContent } : null; })(),
      count: (document.getElementById('mlsOpDayCount') || {}).textContent || '',
      chips: Array.from(document.querySelectorAll('.mlsOpDayCard .mlsOpDayChip')).map((c) => c.textContent),
      pickH: (document.getElementById('mlsOpnPickH') || {}).textContent || '',
    }));
    assert.strictEqual(sample.tally.review, 0, 'held visits must not count as notes to review: ' + JSON.stringify(sample.tally));
    assert.strictEqual(sample.day, 'done', 'a day with nothing to draft has no primary action: ' + sample.day);
    assert.ok(!sample.go || sample.go.hidden, 'no "Review N notes" primary on a day with nothing to draft: ' + JSON.stringify(sample.go));
    assert.doesNotMatch(sample.count, /to finish/, 'held visits are not "to finish": ' + sample.count);
    assert.match(sample.count, /no op note needed/, 'the count line says why: ' + sample.count);
    assert.ok(sample.chips.length >= 4 && sample.chips.every((c) => c === 'Not a procedure'), 'each row says why it is held: ' + sample.chips.join(', '));
    assert.match(sample.pickH, /No op notes needed/, 'the pane agrees with the rail: ' + sample.pickH);

    /* 2. a procedure day with one routine follow-up, drafted by the runner
       the room's Draft-all click reaches (no skip list passed) */
    const seeded = await page.evaluate(() => {
      const DAY = window._opPrepDay;
      const NAMES = ['Ada Synthetic', 'Bo Synthetic', 'Cy Synthetic'];
      const PROCS = ['Caudal epidural steroid injection', 'Lumbar medial branch block', 'Routine follow-up'];
      try { window.savePatients((window.getPatients() || []).concat(NAMES.map((n, i) => ({ id: 'held-syn-' + i, name: n, dob: '1960-01-0' + (i + 1), notes: [], visits: [] })))); } catch (e) {}
      window._calAppts = NAMES.map((n, i) => ({ id: 'held-appt-' + i, name: n, patientId: 'held-syn-' + i, appt_date: DAY, start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: PROCS[i] }));
      window._opPrep = NAMES.map((n, i) => window._opNewRow(n, PROCS[i], '1960-01-0' + (i + 1), DAY, 'held-syn-' + i, { name: n, reason: PROCS[i], start_at: DAY + 'T0' + (8 + i) + ':00:00' }, DAY));
      window.opPrepRender();
      const tri = window.__mlsOpNoteDayBrain.triageAll().map((t) => t.verdict);
      return { tri, hasRunner: !!(window.__mlsTplPrepFix && window.__mlsTplPrepFix.draftAll) };
    });
    assert.deepStrictEqual(seeded.tri, ['needs', 'needs', 'held'], 'triage of the seeded day: ' + JSON.stringify(seeded.tri));
    assert.ok(seeded.hasRunner, 'the Draft-all runner is installed');
    const skips = await page.evaluate(() => window.__mlsOpNoteDayBrain.terminalSkipReasons());
    assert.deepStrictEqual(Object.keys(skips), ['2'], 'the day-brain names the follow-up as a skip: ' + JSON.stringify(skips));
    await page.evaluate(() => { window.__heldRun = window.__mlsTplPrepFix.draftAll(); });
    await page.waitForFunction(() => { const l = document.getElementById('tpfLedgerList'); return l && l.children.length === 3 && Array.from(l.children).every((c) => /^(ok|bad|skip)$/.test(c.className)); }, null, { timeout: 120000 });
    const ledger = await page.evaluate(() => Array.from(document.getElementById('tpfLedgerList').children).map((c) => ({ cls: c.className, text: c.textContent })));
    assert.strictEqual(ledger[2].cls, 'skip', 'the routine follow-up is skipped, not failed: ' + JSON.stringify(ledger[2]));
    assert.doesNotMatch(ledger[2].text, /gave no reason|failed/i, 'the skip says why: ' + ledger[2].text);
    assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS op-note held visits are not unfinished: sample day has no "Review N notes" and says why; a real Draft-all run skips the follow-up instead of failing it');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
