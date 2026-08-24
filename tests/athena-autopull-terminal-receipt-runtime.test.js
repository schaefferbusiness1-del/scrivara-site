'use strict';

/* A successful mlsAppAllVisitsResult used to paint the auto-pull bar at 100%
 * for every request in the tab. After the owning pull had already completed
 * and hidden its bar, a later background/day result resurrected
 * "All encounters read — saving…" forever because that request's terminal
 * belonged to another surface. Drive the real feat_athena_autopull.js in
 * Chromium and prove request ownership plus both persistence terminals. */

const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

async function makeHarness(browser, saveMode) {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head></head><body>
    <div id="mlsPullDoor"><button id="ptPullAthenaBtn" type="button">Pull</button></div>
    <section id="profileCard"></section>
  </body></html>`);
  await page.evaluate(mode => {
    /* Scale only the two bar-retirement delays. Bridge timeouts remain real so
       cycle B can deliberately pause in capture across cycle A's deadline. */
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => nativeSetTimeout(fn,
      Number(ms) === 2500 || Number(ms) === 16000 || Number(ms) === 30000 ? 250 : ms, ...args);

    window.__saveMode = mode;
    window.__store = [];
    window.__statusTimeline = [];
    window.__saveCommitted = false;
    window.__saveApplied = false;
    window.__saveCalls = 0;
    window.__receivedReceipt = null;
    window.__ownedRequestId = '';
    window.__ownedResponse = null;
    window.__requestSequence = 0;
    window.__holdCapture = false;
    window.__releaseHeldCapture = null;
    window.__resolveBatchEnd = null;
    window.__rejectBatchEnd = null;
    if (mode === 'noop') {
      window.__store.push({
        id: 'preexisting-patient', name: 'Synthetic Patient', dob: '01/02/1970', mrn: 'SYN-1',
        visits: ['old-a', 'old-b'].map(key => ({
          encounterId: key, sourceVisitKey: key, date: '2026-07-01', raw: 'Older unrelated body ' + key,
          source: 'athena-copy', identityVerified: true, identityBinding: 'preexisting-patient',
          fullDetail: true, bodyComplete: true, indexOnly: false
        }))
      });
    }
    window.getPatients = () => window.__store;
    window.upsertPatient = patient => {
      const index = window.__store.findIndex(row => row && row.id === patient.id);
      if (index >= 0) window.__store[index] = patient;
      else window.__store.push(patient);
      return true;
    };
    window.pullPatientFromAthenaPrompt = function () {};
    window.openPatient = function () {};
    window.setActivePtId = function () {};
    window.showView = function () {};
    window.renderPatients = function () {};
    window.renderProfile = function () {};
    window.toast = function () {};

    window.__mlsVisitModel = {
      _normDob(value) { return String(value || ''); },
      _normVisit(row, source, opts) {
        row = row && typeof row === 'object' ? row : {};
        return {
          id: row.id || 'normalized', date: row.date || '', type: row.type || '',
          encounterId: String(row.encounterId || row.encounterID || ''),
          sourceVisitKey: String(row.sourceVisitKey || row.rowKey || ''),
          raw: String(row.raw || row.text || row.note || row.detail || '').trim(),
          source: source || 'athena-copy', identityVerified: opts && opts.identityVerified === true,
          identityBinding: String(opts && opts.identityBinding || ''), indexOnly: row.indexOnly === true,
          fullDetail: row.fullDetail === true && row.indexOnly !== true,
          bodyComplete: !!(opts && opts.bodyComplete === true && row.fullDetail === true && row.indexOnly !== true)
        };
      },
      getVisits(patient) { return Array.isArray(patient && patient.visits) ? patient.visits : []; },
      ensureSummaries() { return Promise.resolve({ ok: true }); }
    };
    window.__mlsPatientStoreBatch = {
      begin() { return { active: true, id: 'synthetic-batch-' + Date.now() }; },
      end(token) {
        if (token) token.active = false;
        if (window.__saveMode === 'flush-reject' && window.__saveApplied) {
          return Promise.reject(new Error('Synthetic durable flush rejected'));
        }
        if (window.__saveMode === 'deferred' && window.__saveApplied) {
          return new Promise((resolve, reject) => {
            window.__resolveBatchEnd = () => { window.__saveCommitted = true; resolve({ flushes: 1 }); };
            window.__rejectBatchEnd = reject;
          });
        }
        if (window.__saveMode === 'flush-timeout' && window.__saveApplied) {
          return new Promise(() => {});
        }
        if (window.__saveApplied) window.__saveCommitted = true;
        return Promise.resolve({ flushes: window.__saveApplied ? 1 : 0 });
      }
    };
    window.__mlsChartField = { read() { return Promise.resolve({ ok: true }); } };
    window.__mlsCopyVisits = {
      _driveRequest() {
        const requestId = 'owned-autopull-request-' + (++window.__requestSequence);
        window.__ownedRequestId = requestId;
        window.postMessage({ source: 'mls-app', type: 'mlsAppReadAllVisits', id: requestId, requestId }, '*');
        return new Promise(resolve => {
          window.__emitOwnedResult = () => {
            const response = {
              source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: requestId, requestId, ok: true,
              identity: { name: 'Synthetic Patient', dob: '01/02/1970', mrn: 'SYN-1' },
              visits: [{
                id: 'visit-1', encounterId: 'encounter-1', sourceVisitKey: 'source-1',
                date: '2026-08-24', raw: 'Synthetic visit body.', fullDetail: true
              }],
              receipt: {
                complete: true, indexComplete: true, bodyComplete: window.__saveMode !== 'incomplete',
                fullDetail: true, parsed: 1, expected: 1
              }
            };
            window.__ownedResponse = response;
            window.postMessage(response, '*');
          };
          window.__resolveOwnedResult = () => resolve(window.__ownedResponse);
        });
      },
      _saveVisits(patient, identity, visits, onStatus, receipt) {
        window.__saveCalls++;
        window.__receivedReceipt = receipt;
        if (window.__saveMode === 'reject') throw new Error('Synthetic local persistence rejected');
        const current = window.__store.find(row => row && row.id === patient.id);
        if (!current) throw new Error('Synthetic patient missing from store');
        if (window.__saveMode === 'noop') return visits.length;
        current.visits = visits.map(visit => Object.assign({}, visit, {
          source: 'athena-copy', identityVerified: true, identityBinding: patient.id,
          fullDetail: true, bodyComplete: true, indexOnly: false
        }));
        window.upsertPatient(current);
        window.__saveApplied = true;
        return visits.length;
      }
    };

    window.addEventListener('message', event => {
      const data = event.data || {};
      if (data.source !== 'mls-app' || data.type !== 'mlsAppCapture') return;
      const reply = () => window.postMessage({
          source: 'mls-ext', type: 'mlsAppCaptureResult',
          resp: { ok: true, captured: { name: 'Synthetic Patient', dob: '01/02/1970', mrn: 'SYN-1' } }
        }, '*');
      if (window.__holdCapture) window.__releaseHeldCapture = reply;
      else window.setTimeout(reply, 0);
    });
  }, saveMode);
  await page.addScriptTag({ path: path.join(root, 'feat_athena_autopull.js') });
  await page.waitForFunction(() => window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.installed);
  return page;
}

async function startAndPause(page) {
  await page.evaluate(() => {
    window.__runPromise = window.__mlsAthenaAutoPull.run(message => {
      window.__statusTimeline.push({ message: String(message || ''), committed: window.__saveCommitted === true });
    });
  });
  await page.waitForFunction(() => typeof window.__emitOwnedResult === 'function');
  await page.evaluate(() => window.postMessage({
    source: 'mls-ext', type: 'mlsAppVisitsProgress', id: window.__ownedRequestId,
    requestId: window.__ownedRequestId, n: 1, total: 2, message: 'Reading the owned chart…'
  }, '*'));
  await page.waitForFunction(() => {
    const text = document.querySelector('#mlsPullBar [data-text]');
    return text && /owned chart/.test(text.textContent);
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const successPage = await makeHarness(browser, 'success');
    await startAndPause(successPage);

    /* An unrelated success while this run is active must not take ownership. */
    const beforeOther = await successPage.locator('#mlsPullBar [data-text]').textContent();
    await successPage.evaluate(() => window.postMessage({
      source: 'mls-app', type: 'mlsAppReadAllVisits', id: 'background-outbound-request',
      requestId: 'background-outbound-request'
    }, '*'));
    await successPage.evaluate(() => window.postMessage({
      source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'background-day-request',
      requestId: 'background-day-request', ok: true, visits: []
    }, '*'));
    await successPage.waitForTimeout(20);
    assert.strictEqual(await successPage.locator('#mlsPullBar [data-text]').textContent(), beforeOther,
      'an unrelated successful result repainted the active auto-pull bar');

    /* The owned result may say only that local persistence is being verified. */
    await successPage.evaluate(() => window.__emitOwnedResult());
    await successPage.waitForFunction(() => /verifying the local save/.test(
      document.querySelector('#mlsPullBar [data-text]').textContent));
    const preCommitText = await successPage.locator('#mlsPullBar [data-text]').textContent();
    assert(!/\bsaved\b/i.test(preCommitText), 'the bar claimed saved before the local store confirmed it: ' + preCommitText);

    await successPage.evaluate(() => window.__resolveOwnedResult());
    const success = await successPage.evaluate(() => window.__runPromise);
    assert(success && success.ok === true, 'the confirmed success path did not resolve successfully');
    assert(success.receipt && success.receipt.ok === true && success.receipt.persistenceConfirmed === true,
      'success did not return a persistence-confirmed terminal receipt');
    assert.strictEqual(await successPage.evaluate(() => window.__receivedReceipt === window.__ownedResponse.receipt), true,
      'the exact full-detail reader receipt was not forwarded as _saveVisits argument five');
    const successTimeline = await successPage.evaluate(() => window.__statusTimeline);
    const firstSaved = successTimeline.find(row => /\bsaved\b/i.test(row.message));
    assert(firstSaved && firstSaved.committed === true,
      'success wording appeared before the synthetic local commit was readable');

    /* Cycle A has a terminal hide timer pending. Start cycle B but deliberately
       hold its capture, before _driveRequest can emit progress/setBar. At A's
       deadline B must remain visibly active; this failed when A's stale timer
       hid the shared bar out from under B. */
    await successPage.evaluate(() => {
      window.__holdCapture = true;
      window.__releaseHeldCapture = null;
      window.__emitOwnedResult = null;
      window.__resolveOwnedResult = null;
      window.__saveCommitted = false;
      window.__saveApplied = false;
      window.__runPromise = window.__mlsAthenaAutoPull.run(message => {
        window.__statusTimeline.push({ message: String(message || ''), committed: window.__saveCommitted === true });
      });
    });
    await successPage.waitForFunction(() => window.__mlsAthenaAutoPull.isBusy() &&
      typeof window.__releaseHeldCapture === 'function');
    await successPage.waitForTimeout(320);
    assert.strictEqual(await successPage.evaluate(() => window.__mlsAthenaAutoPull.isBusy()), true,
      'cycle B was not active at cycle A\'s retirement deadline');
    assert.strictEqual(await successPage.locator('#mlsPullBar').evaluate(node => node.style.display), 'block',
      'cycle A\'s stale terminal timer hid the active cycle B bar');
    assert(/checking who is open/i.test(await successPage.locator('#mlsPullBar [data-text]').textContent()),
      'cycle B did not retain its checking status across cycle A\'s deadline');

    /* Let cycle B finish so its own terminal timer remains independently
       responsible for retiring the shared bar. */
    await successPage.evaluate(() => {
      window.__holdCapture = false;
      window.__releaseHeldCapture();
    });
    await successPage.waitForFunction(() => typeof window.__emitOwnedResult === 'function');
    await successPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    const secondSuccess = await successPage.evaluate(() => window.__runPromise);
    assert(secondSuccess && secondSuccess.ok === true,
      'cycle B did not complete after the stale-timer assertion');

    /* The real cycle-B retirement fires, then a later background success must
       not resurrect the bar — this is the exact screenshot regression. */
    await successPage.waitForTimeout(320);
    assert.strictEqual(await successPage.locator('#mlsPullBar').evaluate(node => node.style.display), 'none',
      'the successful owner did not retire its bar');
    await successPage.evaluate(() => window.postMessage({
      source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: 'late-background-request',
      requestId: 'late-background-request', ok: true, visits: []
    }, '*'));
    await successPage.waitForTimeout(30);
    assert.strictEqual(await successPage.locator('#mlsPullBar').evaluate(node => node.style.display), 'none',
      'a late unrelated success resurrected the retired bar at “saving”');
    await successPage.close();

    const failurePage = await makeHarness(browser, 'reject');
    await startAndPause(failurePage);
    await failurePage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    await failurePage.evaluate(() => window.__runPromise);
    const failure = await failurePage.evaluate(() => ({
      receipt: window.__mlsAthenaAutoPull.terminalReceipt(),
      text: document.querySelector('#mlsPullBar [data-text]').textContent,
      committed: window.__saveCommitted
    }));
    assert(failure.receipt && failure.receipt.ok === false && failure.receipt.persistenceConfirmed === false,
      'a rejected persistence path did not produce a failed terminal receipt');
    assert(/^⚠/.test(failure.text) && !/✓|\bDone\b|\bSaved \d/i.test(failure.text),
      'a rejected persistence path displayed success: ' + failure.text);
    assert.strictEqual(failure.committed, false, 'the failure fixture unexpectedly committed visits');
    assert.strictEqual(await failurePage.evaluate(() => window.__mlsAthenaAutoPull.isBusy()), false,
      'the failed pull left the auto-pull lane busy');
    const failedRequestId = failure.receipt.requestId;
    assert(/^owned-autopull-request-/.test(failedRequestId),
      'the failed terminal receipt did not preserve its owned request ID');
    await failurePage.evaluate(requestId => window.postMessage({
      source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: requestId,
      requestId, ok: true, visits: []
    }, '*'), failedRequestId);
    await failurePage.waitForTimeout(30);
    assert.strictEqual(await failurePage.locator('#mlsPullBar [data-text]').textContent(), failure.text,
      'the failed pull retained ownership and accepted a late success result');
    await failurePage.waitForTimeout(320);
    assert.strictEqual(await failurePage.locator('#mlsPullBar').evaluate(node => node.style.display), 'none',
      'the failed terminal receipt did not retire on its bounded failure timer');
    await failurePage.close();

    /* A successful transport result without the full clinical-detail receipt
       is an index, not a saveable history. It must stop before the writer. */
    const incompletePage = await makeHarness(browser, 'incomplete');
    await startAndPause(incompletePage);
    await incompletePage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    await incompletePage.evaluate(() => window.__runPromise);
    const incomplete = await incompletePage.evaluate(() => ({
      calls: window.__saveCalls, receipt: window.__mlsAthenaAutoPull.terminalReceipt(),
      text: document.querySelector('#mlsPullBar [data-text]').textContent
    }));
    assert.strictEqual(incomplete.calls, 0, 'an incomplete Athena receipt reached the visit writer');
    assert(incomplete.receipt && incomplete.receipt.ok === false && /full-detail-receipt-incomplete/.test(incomplete.receipt.reason),
      'an incomplete Athena receipt did not settle as an explicit failure');
    assert(!/^✓|\bSaved \d|\bDone\b/i.test(incomplete.text), 'an incomplete Athena receipt displayed success');
    await incompletePage.close();

    /* The old count-only readback false-passed this exact case: two unrelated
       old visits made stored.length >= saved even though the new key/body was
       absent. Exact encounter/body readback must reject it. */
    const noopPage = await makeHarness(browser, 'noop');
    await startAndPause(noopPage);
    await noopPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    await noopPage.evaluate(() => window.__runPromise);
    const noop = await noopPage.evaluate(() => ({
      receipt: window.__mlsAthenaAutoPull.terminalReceipt(),
      text: document.querySelector('#mlsPullBar [data-text]').textContent,
      count: window.__store[0] && window.__store[0].visits.length
    }));
    assert.strictEqual(noop.count, 2, 'the no-op fixture unexpectedly changed the old visit set');
    assert(noop.receipt && noop.receipt.ok === false && noop.receipt.persistenceConfirmed === false,
      'unrelated pre-existing visit counts false-confirmed the missing encounter');
    assert(!/^✓|\bSaved \d|\bDone\b/i.test(noop.text), 'the exact-row readback failure displayed success');
    await noopPage.close();

    /* Large rosters persist cooperatively. Green success must wait for the
       owned patient-store batch to flush, not merely for its in-memory view. */
    const deferredPage = await makeHarness(browser, 'deferred');
    await startAndPause(deferredPage);
    await deferredPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    await deferredPage.waitForFunction(() => typeof window.__resolveBatchEnd === 'function');
    const beforeFlush = await deferredPage.evaluate(() => ({
      busy: window.__mlsAthenaAutoPull.isBusy(), committed: window.__saveCommitted,
      savedLine: window.__statusTimeline.some(row => /^✓|\bSaved \d|\bDone\b/.test(row.message))
    }));
    assert.deepStrictEqual(beforeFlush, { busy: true, committed: false, savedLine: false },
      'success appeared before the cooperative patient-store flush resolved');
    await deferredPage.evaluate(() => window.__resolveBatchEnd());
    const deferred = await deferredPage.evaluate(() => window.__runPromise);
    assert(deferred && deferred.ok === true && deferred.receipt.persistenceConfirmed === true,
      'the durable cooperative flush did not unlock confirmed success');
    await deferredPage.close();

    const flushFailurePage = await makeHarness(browser, 'flush-reject');
    await startAndPause(flushFailurePage);
    await flushFailurePage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    await flushFailurePage.evaluate(() => window.__runPromise);
    const flushFailure = await flushFailurePage.evaluate(() => ({
      receipt: window.__mlsAthenaAutoPull.terminalReceipt(),
      text: document.querySelector('#mlsPullBar [data-text]').textContent
    }));
    assert(flushFailure.receipt && flushFailure.receipt.ok === false && flushFailure.receipt.reason === 'patient-save-flush-failed',
      'a rejected durable flush did not fail its terminal receipt');
    assert(!/^✓|\bSaved \d|\bDone\b/i.test(flushFailure.text), 'a rejected durable flush displayed success');
    await flushFailurePage.close();

    /* A hanging cooperative writer must not strand the pull at "saving…".
       The bounded flush should produce the same explicit failed terminal as a
       rejected flush, and release the single-flight lane for a retry. */
    const flushTimeoutPage = await makeHarness(browser, 'flush-timeout');
    await startAndPause(flushTimeoutPage);
    await flushTimeoutPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    await flushTimeoutPage.evaluate(() => window.__runPromise);
    const flushTimeout = await flushTimeoutPage.evaluate(() => ({
      busy: window.__mlsAthenaAutoPull.isBusy(),
      receipt: window.__mlsAthenaAutoPull.terminalReceipt(),
      text: document.querySelector('#mlsPullBar [data-text]').textContent
    }));
    assert.strictEqual(flushTimeout.busy, false, 'a stalled local flush left the pull lane busy');
    assert(flushTimeout.receipt && flushTimeout.receipt.ok === false && flushTimeout.receipt.reason === 'patient-save-flush-failed',
      'a stalled durable flush did not settle as an explicit failure');
    assert(!/^✓|\bSaved \d|\bDone\b/i.test(flushTimeout.text), 'a stalled durable flush displayed success');
    await flushTimeoutPage.close();

    console.log('PASS Athena auto-pull terminal receipt: owned progress, full-detail receipt forwarding, durable exact-row confirmation, bounded failures, stalled-flush timeout, timer isolation, and no late saving-state resurrection');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
