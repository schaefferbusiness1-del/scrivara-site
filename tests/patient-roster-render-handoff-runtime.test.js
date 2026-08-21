'use strict';

/* A successful Athena pull must not leave Patients saying "No patients yet"
   until a manual refresh. This drives the real canonical shell in a real
   headless browser with a synthetic 150-row roster. No login, network account,
   extension, or patient data is used. */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const OPEN = '/* roster-render-handoff-1.0.0';
const CLOSE = 'function renderPatients(){';

assert.strictEqual(source.split(OPEN).length - 1, 1, 'canonical shell must install one roster handoff repair');
const blockStart = source.indexOf(OPEN);
const blockEnd = source.indexOf(CLOSE, blockStart);
assert(blockStart > 0 && blockEnd > blockStart, 'roster handoff repair block is incomplete');
const block = source.slice(blockStart, blockEnd);
assert(block.includes("window.addEventListener('mls:pts-store-updated'"), 'store completion no longer repaints Patients');
assert(block.includes("window.addEventListener('mls:session-boundary',__mlsPtCancelRosterRepair"), 'session boundary no longer cancels a queued repaint');
assert(block.includes("owner.key===key&&owner.epoch===epoch"), 'queued repaint is not bound to both account key and session epoch');
assert(block.includes("String(origin.key||'')!==owner.key||Number(origin.epoch)!==owner.epoch"), 'store repaint trusts the current account at receipt instead of the event origin');
assert(block.includes('renderPatients(); /* fresh account-scoped getPatients(); never cached rows */'), 'repair no longer re-enters the public fresh roster reader');
assert(source.includes('if(batch&&batch.depth>0&&Array.isArray(batch.arr))return __mlsPtsStampRead(batch.arr.slice());'), 'public batch getPatients slice semantics changed');
assert(source.includes('try{return __mlsPtsStampRead(__psR.getRoster().slice());}catch(ePsR){}'), 'public IDB getPatients slice semantics changed');
assert(source.includes('idbReadBlob(refreshKey).then(function(rec){\n      if(!stillOwned()){abandon();return;}'), 'async store refresh can mutate a different account after a session boundary');
assert(source.includes('S.refreshing=false;S.pendingIdbRefresh=false;S.refreshTries=0;'), 'same-account new-epoch refresh can leave the catch-up latch stuck forever');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let pathname = decodeURIComponent(String(req.url || '/').split('?')[0]);
      if (pathname === '/') pathname = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (error, bytes) => {
        if (error) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(bytes);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function portOf(server) { return server.address().port; }

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${portOf(server)}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => typeof window.getPatients === 'function' && typeof window.renderPatients === 'function');

    /* The public reader still returns fresh slices and resolves the current
       account on every call. The repair never changes or wraps it. */
    const publicReader = await page.evaluate(() => {
      window.__mlsHarnessAccountEmail = 'roster-a@synthetic.invalid';
      window.__mlsSessionEpoch = 10;
      const rowsA = [{ id: 'a-1', name: 'Synthetic A' }];
      const rowsB = [{ id: 'b-1', name: 'Synthetic B' }];
      window.__mlsPtsStore = { isReady: () => true, getRoster: () => rowsA, genRead: () => 1, ready: () => Promise.resolve() };
      const first = window.getPatients();
      const second = window.getPatients();
      first.length = 0;
      window.__mlsHarnessAccountEmail = 'roster-b@synthetic.invalid';
      window.__mlsPtsStore = { isReady: () => true, getRoster: () => rowsB, genRead: () => 1, ready: () => Promise.resolve() };
      const other = window.getPatients();
      return {
        separateSlices: first !== second && second.length === 1,
        currentAccountOnly: other.length === 1 && other[0].id === 'b-1' && second[0].id === 'a-1'
      };
    });
    assert(publicReader.separateSlices, 'getPatients stopped returning a fresh roster slice');
    assert(publicReader.currentAccountOnly, 'getPatients reused another account roster');

    /* Reproduce the live failure: the first Patients paint receives the
       fail-closed [] while a 150-row account store is being installed. The
       helper must read ready() on the next task (after the new init promise is
       installed), then repaint without a refresh. */
    const firstPaint = await page.evaluate(() => {
      const rows = Array.from({ length: 150 }, (_, index) => ({
        id: 'hydrated-' + index,
        name: 'Synthetic Patient ' + String(index + 1).padStart(3, '0'),
        dob: '01/01/2000', mrn: 'S-' + index, docs: []
      }));
      let resolveReady;
      const newReady = new Promise(resolve => { resolveReady = resolve; });
      const harness = window.__rosterHandoffHarness = {
        account: 'hydration@synthetic.invalid', epoch: 20, rows,
        mode: 'empty', calls: 0, newReady, resolveReady,
        realRender: window.renderPatients, realGetPatients: window.getPatients
      };
      window.__mlsHarnessAccountEmail = harness.account;
      window.__mlsSessionEpoch = harness.epoch;
      /* This is the just-dispatched identity boundary's old ready promise. */
      window.__mlsPtsStore = { isReady: () => false, ready: () => Promise.resolve('old-account-ready') };
      window.renderPatients = function () { harness.calls++; return harness.realRender(); };
      window.renderPatients();
      const snapshot = {
        calls: harness.calls,
        emptyVisible: document.getElementById('ptEmpty').style.display === 'block',
        rows: document.querySelectorAll('#ptList .pt-item').length
      };
      /* Installed synchronously after the boundary, before the helper's task. */
      window.__mlsPtsStore = {
        isReady: () => harness.mode === 'ready',
        getRoster: () => harness.rows,
        genRead: () => 20,
        ready: () => harness.newReady
      };
      return snapshot;
    });
    assert.deepStrictEqual(firstPaint, { calls: 1, emptyVisible: true, rows: 0 }, 'synthetic setup did not reproduce the transient empty Patients paint');

    await page.evaluate(() => {
      const harness = window.__rosterHandoffHarness;
      harness.mode = 'ready';
      harness.resolveReady();
    });
    await page.waitForFunction(() => document.querySelectorAll('#ptList .pt-item').length === 150, null, { timeout: 5000 });
    const repaired = await page.evaluate(() => ({
      calls: window.__rosterHandoffHarness.calls,
      emptyHidden: document.getElementById('ptEmpty').style.display === 'none',
      rows: document.querySelectorAll('#ptList .pt-item').length
    }));
    assert.strictEqual(repaired.calls, 2, 'hydration completion did not cause exactly one repair paint');
    assert(repaired.emptyHidden && repaired.rows === 150, '150-row roster did not replace the transient empty state');

    /* A ready completion owned by account A must be inert after a session
       boundary moves the page to account B. */
    await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      let resolveOld;
      h.oldReady = new Promise(resolve => { resolveOld = resolve; });
      h.resolveOld = resolveOld;
      h.account = 'late-a@synthetic.invalid'; h.epoch = 30; h.mode = 'empty';
      window.__mlsHarnessAccountEmail = h.account; window.__mlsSessionEpoch = h.epoch;
      window.__mlsPtsStore = { isReady: () => false, ready: () => h.oldReady };
      window.renderPatients();
    });
    await page.waitForTimeout(20); /* the retry is now waiting on account A */
    const boundaryCalls = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      window.__mlsHarnessAccountEmail = 'late-b@synthetic.invalid';
      window.__mlsSessionEpoch = 31;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 31 } }));
      const calls = h.calls;
      h.mode = 'ready'; h.resolveOld();
      return calls;
    });
    await page.waitForTimeout(50);
    assert.strictEqual(await page.evaluate(() => window.__rosterHandoffHarness.calls), boundaryCalls, 'old-account ready completion repainted after the session boundary');
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('#ptList [data-patient-id^="hydrated-"]').length), 0, 'old-account rows survived the boundary');

    /* A queued store event is also cancelled by the same boundary. Then three
       current-account update events coalesce to one fresh 150-row render. */
    const lateEventCalls = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      h.account = 'event-a@synthetic.invalid'; h.epoch = 40; h.mode = 'ready';
      window.__mlsHarnessAccountEmail = h.account; window.__mlsSessionEpoch = h.epoch;
      window.dispatchEvent(new CustomEvent('mls:pts-store-updated', { detail: { key: window.uns('patients'), epoch: 40 } }));
      window.__mlsHarnessAccountEmail = 'event-b@synthetic.invalid'; window.__mlsSessionEpoch = 41;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 41 } }));
      return h.calls;
    });
    await page.waitForTimeout(40);
    assert.strictEqual(await page.evaluate(() => window.__rosterHandoffHarness.calls), lateEventCalls, 'pre-boundary store event repainted the next account');

    const staleOriginCalls = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      const before = h.calls;
      window.dispatchEvent(new CustomEvent('mls:pts-store-updated', {
        detail: { key: 'sf_u::event-a@synthetic.invalid::patients', epoch: 40 }
      }));
      return before;
    });
    await page.waitForTimeout(40);
    assert.strictEqual(await page.evaluate(() => window.__rosterHandoffHarness.calls), staleOriginCalls, 'late old-origin store event was attributed to the current account');

    const coalescedBase = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      h.rows = Array.from({ length: 150 }, (_, index) => ({ id: 'current-' + index, name: 'Current Synthetic ' + index, docs: [] }));
      h.mode = 'ready';
      window.__mlsPtsStore = { isReady: () => h.mode === 'ready', getRoster: () => h.rows, genRead: () => 41, ready: () => Promise.resolve() };
      const before = h.calls;
      const detail = { key: window.uns('patients'), epoch: 41 };
      window.dispatchEvent(new CustomEvent('mls:pts-store-updated', { detail }));
      window.dispatchEvent(new CustomEvent('mls:pts-store-updated', { detail }));
      window.dispatchEvent(new CustomEvent('mls:pts-store-updated', { detail }));
      return before;
    });
    await page.waitForFunction(base => window.__rosterHandoffHarness.calls === base + 1, coalescedBase, { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('#ptList [data-patient-id^="current-"]').length), 150, 'current account store event did not render its roster');

    /* Leaving Patients before the retry's next-task ready() read must retire
       only that retry marker. Returning while the same account is still
       hydrating can then arm a fresh wait and paint when it becomes ready. */
    const awayBeforeReady = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      h.account = 'away-before-ready@synthetic.invalid'; h.epoch = 45; h.mode = 'empty';
      h.rows = Array.from({ length: 150 }, (_, index) => ({ id: 'away-' + index, name: 'Away Synthetic ' + index, docs: [] }));
      window.__mlsHarnessAccountEmail = h.account; window.__mlsSessionEpoch = h.epoch;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 45 } }));
      let resolveFirst;
      h.awayFirstReady = new Promise(resolve => { resolveFirst = resolve; }); h.resolveAwayFirst = resolveFirst;
      window.__mlsPtsStore = { isReady: () => false, ready: () => h.awayFirstReady };
      const before = h.calls;
      window.renderPatients();
      window.showView('visit');
      return { before, after: h.calls };
    });
    assert.strictEqual(awayBeforeReady.after, awayBeforeReady.before + 1, 'away-before-ready setup painted unexpectedly');
    await page.waitForTimeout(40);
    const awayRetired = await page.evaluate(() => ({
      calls: window.__rosterHandoffHarness.calls,
      marker: window.__mlsPtRosterRepair.emptyOwner,
      view: window.__mlsCurrentView
    }));
    assert.strictEqual(awayRetired.calls, awayBeforeReady.after, 'retry painted while Patients was not active');
    assert.strictEqual(awayRetired.marker, '', 'leaving before ready() left the exact-owner retry marker stuck');
    assert.strictEqual(awayRetired.view, 'visit', 'away-before-ready control did not leave Patients');

    await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      let resolveSecond;
      h.awaySecondReady = new Promise(resolve => { resolveSecond = resolve; }); h.resolveAwaySecond = resolveSecond;
      window.__mlsPtsStore = {
        isReady: () => h.mode === 'ready', getRoster: () => h.rows, genRead: () => 45,
        ready: () => h.awaySecondReady
      };
      window.showView('patients');
    });
    await page.waitForTimeout(25);
    await page.evaluate(() => { const h = window.__rosterHandoffHarness; h.mode = 'ready'; h.resolveAwaySecond(); });
    await page.waitForFunction(() => document.querySelectorAll('#ptList [data-patient-id^="away-"]').length === 150, null, { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => window.__rosterHandoffHarness.calls), awayBeforeReady.before + 3,
      'returning during hydration did not produce exactly one fresh wait and one repair paint');

    /* A second navigation edge happens one microtask later: ready resolves
       while Patients is active and queues a paint, then navigation leaves
       before that paint task executes. The paint task must retire its exact
       retry generation so a return can re-arm without touching newer owners. */
    const awayBeforePaint = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      h.account = 'away-before-paint@synthetic.invalid'; h.epoch = 46; h.mode = 'empty';
      h.rows = Array.from({ length: 150 }, (_, index) => ({ id: 'queued-' + index, name: 'Queued Synthetic ' + index, docs: [] }));
      window.__mlsHarnessAccountEmail = h.account; window.__mlsSessionEpoch = h.epoch;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 46 } }));
      let resolveFirst;
      h.queuedFirstReady = new Promise(resolve => { resolveFirst = resolve; }); h.resolveQueuedFirst = resolveFirst;
      window.__mlsPtsStore = { isReady: () => false, ready: () => h.queuedFirstReady };
      const before = h.calls;
      window.renderPatients();
      return { before, after: h.calls };
    });
    await page.waitForTimeout(25); /* retry is now waiting on the first ready barrier */
    await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      h.resolveQueuedFirst();
      queueMicrotask(() => window.showView('visit'));
    });
    await page.waitForTimeout(40);
    const queuedPaintRetired = await page.evaluate(() => ({
      calls: window.__rosterHandoffHarness.calls,
      marker: window.__mlsPtRosterRepair.emptyOwner,
      view: window.__mlsCurrentView
    }));
    assert.strictEqual(queuedPaintRetired.calls, awayBeforePaint.after, 'queued repair painted after leaving Patients');
    assert.strictEqual(queuedPaintRetired.marker, '', 'abandoned queued paint left its exact-owner retry marker stuck');
    assert.strictEqual(queuedPaintRetired.view, 'visit', 'ready-resolve navigation control did not leave before the paint task');

    await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      let resolveSecond;
      h.queuedSecondReady = new Promise(resolve => { resolveSecond = resolve; }); h.resolveQueuedSecond = resolveSecond;
      window.__mlsPtsStore = {
        isReady: () => h.mode === 'ready', getRoster: () => h.rows, genRead: () => 46,
        ready: () => h.queuedSecondReady
      };
      window.showView('patients');
    });
    await page.waitForTimeout(25);
    await page.evaluate(() => { const h = window.__rosterHandoffHarness; h.mode = 'ready'; h.resolveQueuedSecond(); });
    await page.waitForFunction(() => document.querySelectorAll('#ptList [data-patient-id^="queued-"]').length === 150, null, { timeout: 5000 });
    assert.strictEqual(await page.evaluate(() => window.__rosterHandoffHarness.calls), awayBeforePaint.before + 3,
      'return after an abandoned queued paint did not re-arm exactly once');

    /* A genuinely empty account gets one bounded retry, not a render loop. */
    const emptyBase = await page.evaluate(() => {
      const h = window.__rosterHandoffHarness;
      window.__mlsHarnessAccountEmail = 'empty@synthetic.invalid'; window.__mlsSessionEpoch = 50;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 50 } }));
      h.mode = 'empty';
      window.__mlsPtsStore = { isReady: () => true, getRoster: () => [], genRead: () => 50, ready: () => Promise.resolve() };
      const before = h.calls;
      window.renderPatients();
      return before;
    });
    await page.waitForTimeout(80);
    const emptyAfter = await page.evaluate(() => window.__rosterHandoffHarness.calls);
    assert.strictEqual(emptyAfter, emptyBase + 2, 'a true empty account did not stop after one bounded retry');
    await page.waitForTimeout(80);
    assert.strictEqual(await page.evaluate(() => window.__rosterHandoffHarness.calls), emptyAfter, 'true empty account entered a repaint loop');

    console.log('patient-roster-render-handoff: PASS (150-row hydration, coalesced store update, away/back retry retirement, bounded empty retry, account/session isolation)');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
