'use strict';

/* A successful mlsAppAllVisitsResult used to paint the auto-pull bar at 100%
 * for every request in the tab. After the owning pull had already completed
 * and hidden its bar, a later background/day result resurrected
 * "All encounters read — saving…" forever because that request's terminal
 * belonged to another surface. Drive the real feat_athena_autopull.js in
 * Chromium and prove request ownership plus both persistence terminals. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

/* Exercise the exact private production helper in a VM before the browser
 * lifecycle cases. A copied test implementation would let source regressions
 * pass while proving only the copy. */
function verifyProductionFingerprintDomain() {
  const source = fs.readFileSync(path.join(root, 'feat_athena_autopull.js'), 'utf8');
  const start = source.indexOf('  function cardReceiptFingerprint(receipt) {');
  const end = source.indexOf('\n  function emitBusy(value)', start);
  assert(start >= 0 && end > start, 'production cardReceiptFingerprint source was not found');
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + '\nthis.__fingerprint = cardReceiptFingerprint;', context,
    { filename: 'feat_athena_autopull.js#cardReceiptFingerprint' });
  const evidence = JSON.parse(vm.runInContext(`JSON.stringify((function () {
    function receipt(requestId) {
      return {
        complete: true, exactIdentityVerified: true, patientId: 'vm-patient',
        capturedAt: '2026-08-25T12:00:00.000Z', saveRequestId: requestId,
        cards: {
          problems: { status: 'found' }, meds: { status: 'found' },
          allergies: { status: 'found' }, summary: { status: 'found' },
          vitals: { status: 'found' }, history: { status: 'found' }
        }
      };
    }
    var r0 = receipt('r0'), r1 = receipt('r1');
    var stable = __fingerprint(r1);
    var stableClone = __fingerprint(JSON.parse(JSON.stringify(r1)));
    var abaFinal = __fingerprint(r0);

    var dateReceipt = receipt('date');
    var liveDate = new Date('2026-08-25T12:00:01.000Z');
    dateReceipt.adversarial = liveDate;
    var dateT1 = liveDate.getTime(), dateBefore = __fingerprint(dateReceipt);
    liveDate.setTime(Date.parse('2026-08-25T12:00:02.000Z'));
    var dateT2 = liveDate.getTime(), dateAfter = __fingerprint(dateReceipt);

    var nanReceipt = receipt('nan');
    nanReceipt.adversarial = null;
    var nullFingerprint = __fingerprint(nanReceipt);
    nanReceipt.adversarial = NaN;
    var nanFingerprint = __fingerprint(nanReceipt);
    nanReceipt.adversarial = Infinity;
    var infinityFingerprint = __fingerprint(nanReceipt);

    var omittedReceipt = receipt('omitted');
    omittedReceipt.adversarial = undefined;
    var undefinedFingerprint = __fingerprint(omittedReceipt);
    omittedReceipt.adversarial = function () { return null; };
    var functionFingerprint = __fingerprint(omittedReceipt);
    omittedReceipt.adversarial = Symbol('receipt');
    var symbolFingerprint = __fingerprint(omittedReceipt);

    var sparseReceipt = receipt('sparse');
    sparseReceipt.adversarial = [];
    var emptyFingerprint = __fingerprint(sparseReceipt);
    sparseReceipt.adversarial.length = 1;
    var sparseFingerprint = __fingerprint(sparseReceipt);

    var nonPlainReceipt = receipt('non-plain');
    nonPlainReceipt.adversarial = new Map([['status', 'found']]);
    var mapFingerprint = __fingerprint(nonPlainReceipt);
    nonPlainReceipt.adversarial = Object.create(null);
    nonPlainReceipt.adversarial.status = 'found';
    var nullPrototypeFingerprint = __fingerprint(nonPlainReceipt);

    var symbolKeyReceipt = receipt('symbol-key');
    symbolKeyReceipt[Symbol('hidden')] = 'changed';
    var symbolKeyFingerprint = __fingerprint(symbolKeyReceipt);
    var aliasedReceipt = receipt('alias');
    var sharedCard = { status: 'found' };
    aliasedReceipt.left = sharedCard;
    aliasedReceipt.right = sharedCard;
    var aliasedFingerprint = __fingerprint(aliasedReceipt);
    var zeroFingerprint = __fingerprint({ value: 0 });
    var negativeZeroFingerprint = __fingerprint({ value: -0 });
    return {
      stable: stable, stableClone: stableClone, abaFinal: abaFinal,
      dateT1: dateT1, dateT2: dateT2, dateBefore: dateBefore, dateAfter: dateAfter,
      nullFingerprint: nullFingerprint, nanFingerprint: nanFingerprint,
      infinityFingerprint: infinityFingerprint, undefinedFingerprint: undefinedFingerprint,
      functionFingerprint: functionFingerprint, symbolFingerprint: symbolFingerprint,
      emptyFingerprint: emptyFingerprint, sparseFingerprint: sparseFingerprint,
      mapFingerprint: mapFingerprint, nullPrototypeFingerprint: nullPrototypeFingerprint,
      symbolKeyFingerprint: symbolKeyFingerprint, aliasedFingerprint: aliasedFingerprint,
      zeroFingerprint: zeroFingerprint,
      negativeZeroFingerprint: negativeZeroFingerprint
    };
  })())`, context));
  assert(evidence.stable && evidence.stable === evidence.stableClone,
    'stable JSON-plain R1 did not retain one canonical fingerprint');
  assert(evidence.abaFinal && evidence.abaFinal !== evidence.stable,
    'ordinary R0/R1 ABA receipts did not have distinct fingerprints');
  assert(evidence.dateT2 > evidence.dateT1 && evidence.dateBefore === '' && evidence.dateAfter === '',
    'an in-place Date T+1 to T+2 receipt mutation did not fail closed');
  assert(evidence.nullFingerprint && evidence.nanFingerprint === '' && evidence.infinityFingerprint === '',
    'null was not accepted distinctly while non-finite numbers failed closed');
  assert.strictEqual(evidence.undefinedFingerprint, '', 'undefined receipt data did not fail closed');
  assert.strictEqual(evidence.functionFingerprint, '', 'function receipt data did not fail closed');
  assert.strictEqual(evidence.symbolFingerprint, '', 'symbol receipt data did not fail closed');
  assert(evidence.emptyFingerprint && evidence.sparseFingerprint === '',
    'a sparse array was not distinguished from an accepted empty array');
  assert.strictEqual(evidence.mapFingerprint, '', 'a non-plain Map receipt value did not fail closed');
  assert.strictEqual(evidence.nullPrototypeFingerprint, '', 'a null-prototype receipt value did not fail closed');
  assert.strictEqual(evidence.symbolKeyFingerprint, '', 'a symbol-keyed receipt mutation did not fail closed');
  assert.strictEqual(evidence.aliasedFingerprint, '', 'an aliased object graph did not fail closed');
  assert(evidence.zeroFingerprint && evidence.negativeZeroFingerprint &&
    evidence.zeroFingerprint !== evidence.negativeZeroFingerprint,
    'finite primitive fingerprinting merged 0 and -0');
}

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
      Number(ms) === 2500 || Number(ms) === 16000 || Number(ms) === 30000 || Number(ms) === 252000 ? 250 : ms, ...args);

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
      if (['coverage-no-refresh', 'coverage-aba-future', 'coverage-r1-stable'].includes(window.__saveMode) &&
          !patient.athenaProfileCoverage) {
        patient.athenaProfileCoverage = {
          complete: true, exactIdentityVerified: true, patientId: patient.id,
          /* Slightly ahead of the next call so timestamp freshness alone would
             accept it; the unchanged fingerprint must still reject it. */
          capturedAt: new Date(Date.now() + 1000).toISOString(),
          saveRequestId: 'pre-existing-same-tick-receipt',
          cards: {
            problems: { status: 'found' }, meds: { status: 'found' }, allergies: { status: 'found' },
            summary: { status: 'found' }, vitals: { status: 'found' }, history: { status: 'found' }
          }
        };
        window.__coverageR0 = JSON.parse(JSON.stringify(patient.athenaProfileCoverage));
      }
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
      ensureSummaries() {
        if (window.__saveMode === 'summary-timeout') return new Promise(() => {});
        if (['coverage-race', 'coverage-race-stale', 'coverage-aba-future', 'coverage-r1-stable',
          'coverage-inplace', 'coverage-cyclic', 'coverage-bigint', 'coverage-date-inplace',
          'coverage-null-to-nan', 'coverage-undefined-to-function', 'coverage-empty-to-sparse'].includes(window.__saveMode)) {
          return new Promise(resolve => window.setTimeout(() => resolve({ ok: true }), 40));
        }
        return Promise.resolve({ ok: true });
      }
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
    window.__mlsChartField = {
      read(patient) {
        if (window.__saveMode === 'card-timeout') return new Promise(() => {});
        const current = window.__store.find(row => row && row.id === patient.id);
        if (current && window.__saveMode !== 'coverage-missing' && window.__saveMode !== 'coverage-no-refresh') {
          const sameTickReplacement = ['coverage-aba-future', 'coverage-r1-stable'].includes(window.__saveMode);
          current.athenaProfileCoverage = {
            complete: true, exactIdentityVerified: true,
            patientId: window.__saveMode === 'coverage-wrong-patient' ? 'different-patient' : patient.id,
            capturedAt: sameTickReplacement
              ? window.__coverageR0.capturedAt
              : (window.__saveMode === 'coverage-stale'
                ? '2025-01-01T00:00:00.000Z'
                : (window.__saveMode === 'coverage-prior-attempt'
                  ? new Date(Date.now() - 100).toISOString() : new Date().toISOString())),
            saveRequestId: sameTickReplacement ? 'synthetic-r1-same-captured-at' : 'synthetic-card-read-' + Date.now(),
            cards: {
              problems: { status: 'found' }, meds: { status: 'found' }, allergies: { status: 'found' },
              summary: { status: 'found' }, vitals: { status: 'found' }, history: { status: 'found' }
            }
          };
          if (window.__saveMode === 'coverage-date-inplace') {
            current.athenaProfileCoverage.adversarial = new Date('2026-08-25T12:00:01.000Z');
          } else if (window.__saveMode === 'coverage-null-to-nan') {
            current.athenaProfileCoverage.adversarial = null;
          } else if (window.__saveMode === 'coverage-undefined-to-function') {
            current.athenaProfileCoverage.adversarial = undefined;
          } else if (window.__saveMode === 'coverage-empty-to-sparse') {
            current.athenaProfileCoverage.adversarial = [];
          }
          if (sameTickReplacement) {
            window.__coverageR1 = JSON.parse(JSON.stringify(current.athenaProfileCoverage));
          }
          window.upsertPatient(current);
          if (['coverage-race', 'coverage-race-stale', 'coverage-aba-future',
            'coverage-inplace', 'coverage-cyclic', 'coverage-bigint', 'coverage-date-inplace',
            'coverage-null-to-nan', 'coverage-undefined-to-function', 'coverage-empty-to-sparse'].includes(window.__saveMode)) {
            window.setTimeout(() => {
              const raced = window.__store.find(row => row && row.id === patient.id);
              if (window.__saveMode === 'coverage-aba-future') {
                raced.athenaProfileCoverage = JSON.parse(JSON.stringify(window.__coverageR0));
              } else if (window.__saveMode === 'coverage-race-stale') {
                raced.athenaProfileCoverage = Object.assign({}, raced.athenaProfileCoverage, {
                  capturedAt: '2025-01-01T00:00:00.000Z', saveRequestId: 'later-stale-swap'
                });
              } else if (window.__saveMode === 'coverage-inplace') {
                raced.athenaProfileCoverage.cards.history.status = 'changed-in-place-after-acceptance';
              } else if (window.__saveMode === 'coverage-cyclic') {
                raced.athenaProfileCoverage.self = raced.athenaProfileCoverage;
              } else if (window.__saveMode === 'coverage-bigint') {
                raced.athenaProfileCoverage.nonSerializableMutation = BigInt(1);
              } else if (window.__saveMode === 'coverage-date-inplace') {
                raced.athenaProfileCoverage.adversarial.setTime(Date.parse('2026-08-25T12:00:02.000Z'));
              } else if (window.__saveMode === 'coverage-null-to-nan') {
                raced.athenaProfileCoverage.adversarial = NaN;
              } else if (window.__saveMode === 'coverage-undefined-to-function') {
                raced.athenaProfileCoverage.adversarial = function () { return null; };
              } else if (window.__saveMode === 'coverage-empty-to-sparse') {
                raced.athenaProfileCoverage.adversarial.length = 1;
              } else {
                raced.athenaProfileCoverage = Object.assign({}, raced.athenaProfileCoverage, { patientId: 'different-patient' });
              }
              window.upsertPatient(raced);
              window.__coverageSwapApplied = window.__saveMode;
            }, 10);
          }
        }
        return Promise.resolve({ ok: true });
      }
    };
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
          window.__resolveOwnedResult = () => {
            if (window.__saveMode !== 'driver-hang-after-result') resolve(window.__ownedResponse);
          };
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

verifyProductionFingerprintDomain();

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

    /* The owned result may say only that its completion receipt is being
       validated; local persistence has not started yet. */
    await successPage.evaluate(() => window.__emitOwnedResult());
    await successPage.waitForFunction(() => /validating the owned completion receipt/.test(
      document.querySelector('#mlsPullBar [data-text]').textContent));
    const preCommitText = await successPage.locator('#mlsPullBar [data-text]').textContent();
    assert(!/\bsaved\b/i.test(preCommitText), 'the bar claimed saved before the local store confirmed it: ' + preCommitText);

    await successPage.evaluate(() => window.__resolveOwnedResult());
    const success = await successPage.evaluate(() => window.__runPromise);
    assert(success && success.ok === true, 'the confirmed success path did not resolve successfully');
    assert(success.receipt && success.receipt.ok === true && success.receipt.status === 'complete' && success.receipt.persistenceConfirmed === true,
      'success did not return a persistence-confirmed terminal receipt');
    assert.strictEqual(await successPage.evaluate(() => window.__receivedReceipt === window.__ownedResponse.receipt), true,
      'the exact full-detail reader receipt was not forwarded as _saveVisits argument five');
    assert.strictEqual(await successPage.evaluate(() => window.__saveCalls), 1,
      'one owned pull invoked the visit writer more than once');
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
    assert.strictEqual(await successPage.evaluate(() => window.__saveCalls), 2,
      'two owned pulls did not invoke exactly one visit writer each');

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
    assert.strictEqual(await successPage.evaluate(() => window.__saveCalls), 2,
      'a late unrelated result resurrected the writer after both owned pulls settled');
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

    /* Even a loader/runtime defect that emits the owned successful result but
       never settles driveRequest must not strand the UI at its pre-save state.
       No writer runs because the owned completion promise never closed. */
    const driverHangPage = await makeHarness(browser, 'driver-hang-after-result');
    await startAndPause(driverHangPage);
    await driverHangPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    const driverHang = await driverHangPage.evaluate(() => window.__runPromise.then(() => ({
      busy: window.__mlsAthenaAutoPull.isBusy(), calls: window.__saveCalls,
      receipt: window.__mlsAthenaAutoPull.terminalReceipt(),
      text: document.querySelector('#mlsPullBar [data-text]').textContent
    })));
    assert.strictEqual(driverHang.busy, false, 'an owned result with a hung driver left the pull lane busy');
    assert.strictEqual(driverHang.calls, 0, 'a completion result without a settled owner reached the writer');
    assert(driverHang.receipt && driverHang.receipt.status === 'failed' && driverHang.receipt.reason === 'visit-driver-result-timeout',
      'the hung owned completion did not produce an actionable failed terminal receipt');
    assert(/^⚠/.test(driverHang.text) && /Reload MLS and MLS Assist/.test(driverHang.text),
      'the hung owned completion did not replace the transient state with retry guidance');
    await driverHangPage.close();

    /* cardRes.ok is transport/task status, not six-card provenance. Missing,
       wrong-patient, stale, and post-read swapped receipts must all retain the
       durable visit success while refusing a complete/full-card claim. */
    for (const mode of ['coverage-missing', 'coverage-wrong-patient', 'coverage-stale', 'coverage-prior-attempt',
      'coverage-no-refresh', 'coverage-race', 'coverage-race-stale', 'coverage-aba-future',
      'coverage-inplace', 'coverage-cyclic', 'coverage-bigint', 'coverage-date-inplace',
      'coverage-null-to-nan', 'coverage-undefined-to-function', 'coverage-empty-to-sparse']) {
      const receiptPage = await makeHarness(browser, mode);
      await startAndPause(receiptPage);
      await receiptPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
      const observed = await receiptPage.evaluate(() => window.__runPromise.then(result => ({
        busy: window.__mlsAthenaAutoPull.isBusy(), calls: window.__saveCalls, receipt: result.receipt,
        swap: window.__coverageSwapApplied || '',
        text: document.querySelector('#mlsPullBar [data-text]').textContent,
        /* Do not serialize the deliberately cyclic/BigInt fixtures back
           through Playwright. Only the replacement-ABA case needs details. */
        coverage: window.__saveMode === 'coverage-aba-future' ? {
          r0: window.__coverageR0 || null, r1: window.__coverageR1 || null,
          current: window.__store[0] && window.__store[0].athenaProfileCoverage || null,
          swap: window.__coverageSwapApplied || '', now: Date.now()
        } : null
      })));
      assert.strictEqual(observed.busy, false, `${mode}: receipt refusal left the pull lane busy`);
      assert.strictEqual(observed.calls, 1, `${mode}: one pull did not retain exactly one visit writer`);
      if (['coverage-race', 'coverage-race-stale', 'coverage-aba-future', 'coverage-inplace',
        'coverage-cyclic', 'coverage-bigint', 'coverage-date-inplace', 'coverage-null-to-nan',
        'coverage-undefined-to-function', 'coverage-empty-to-sparse'].includes(mode)) {
        assert.strictEqual(observed.swap, mode, `${mode}: adversarial receipt mutation did not happen before terminal proof`);
      }
      assert(observed.receipt && observed.receipt.ok === true && observed.receipt.status === 'partial' &&
        observed.receipt.persistenceConfirmed === true,
        `${mode}: cardRes.ok without a current fresh exact receipt falsely completed the pull`);
      assert(/Visits saved/i.test(observed.text) && /full chart card is incomplete/i.test(observed.text) &&
        !/with the full chart card verified/i.test(observed.text),
        `${mode}: terminal text falsely claimed full-card verification: ${observed.text}`);
      if (mode === 'coverage-aba-future') {
        assert(observed.coverage.r0 && observed.coverage.r1 &&
          observed.coverage.r0.capturedAt === observed.coverage.r1.capturedAt &&
          observed.coverage.r0.saveRequestId !== observed.coverage.r1.saveRequestId,
          'ABA fixture did not create distinct R0/R1 receipts in the same capturedAt millisecond');
        assert(Date.parse(observed.coverage.r0.capturedAt) > observed.coverage.now &&
          observed.coverage.current.saveRequestId === observed.coverage.r0.saveRequestId &&
          observed.coverage.swap === mode,
          'ABA fixture did not restore the allowed-future R0 before the terminal proof');
      }
      await receiptPage.close();
    }

    /* R0 and R1 may share the same allowed-future capturedAt. A changed
       per-attempt fingerprint is valid only while that exact R1 remains the
       current receipt at the terminal boundary. Keep the non-raced control so
       the ABA guard cannot accidentally reject an unchanged accepted R1. */
    const stableReceiptPage = await makeHarness(browser, 'coverage-r1-stable');
    await startAndPause(stableReceiptPage);
    await stableReceiptPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    const stableReceipt = await stableReceiptPage.evaluate(() => window.__runPromise.then(result => ({
      busy: window.__mlsAthenaAutoPull.isBusy(), calls: window.__saveCalls,
      receipt: result.receipt, text: document.querySelector('#mlsPullBar [data-text]').textContent
    })));
    assert.strictEqual(stableReceipt.busy, false, 'the stable R1 control left the pull lane busy');
    assert.strictEqual(stableReceipt.calls, 1, 'the stable R1 control invoked more than one visit writer');
    assert(stableReceipt.receipt && stableReceipt.receipt.ok === true && stableReceipt.receipt.status === 'complete',
      'an unchanged accepted R1 receipt was rejected at the terminal boundary');
    assert(/with the full chart card verified/i.test(stableReceipt.text),
      `the unchanged R1 control did not report full-card verification: ${stableReceipt.text}`);
    await stableReceiptPage.close();

    /* Durable visit persistence settles the pull before optional enrichment.
       A never-resolving summary pass must not retain the single-flight lane or
       prevent a later retry, and it must not rewrite the confirmed receipt as
       a failure. */
    const summaryTimeoutPage = await makeHarness(browser, 'summary-timeout');
    await startAndPause(summaryTimeoutPage);
    await summaryTimeoutPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    const summaryTimeout = await summaryTimeoutPage.evaluate(() => window.__runPromise.then(result => ({
      busy: window.__mlsAthenaAutoPull.isBusy(), receipt: result.receipt,
      text: document.querySelector('#mlsPullBar [data-text]').textContent
    })));
    assert.strictEqual(summaryTimeout.busy, false, 'a stalled summary pass left the auto-pull lane busy');
    assert(summaryTimeout.receipt && summaryTimeout.receipt.ok === true && summaryTimeout.receipt.persistenceConfirmed === true,
      'a stalled summary pass rewrote the durable visit success as failure');
    assert(/Done|Saved \d/i.test(summaryTimeout.text), 'the stalled summary pass did not leave a terminal success line');
    await summaryTimeoutPage.close();

    /* The same contract applies to the optional full chart-card rail. */
    const cardTimeoutPage = await makeHarness(browser, 'card-timeout');
    await startAndPause(cardTimeoutPage);
    await cardTimeoutPage.evaluate(() => { window.__emitOwnedResult(); window.__resolveOwnedResult(); });
    const cardTimeout = await cardTimeoutPage.evaluate(() => window.__runPromise.then(result => ({
      busy: window.__mlsAthenaAutoPull.isBusy(), receipt: result.receipt,
      text: document.querySelector('#mlsPullBar [data-text]').textContent
    })));
    assert.strictEqual(cardTimeout.busy, false, 'a stalled chart-card read left the auto-pull lane busy');
    assert(cardTimeout.receipt && cardTimeout.receipt.ok === true && cardTimeout.receipt.status === 'partial' && cardTimeout.receipt.persistenceConfirmed === true,
      'a stalled chart-card read rewrote the durable visit success as failure');
    assert(/Visits saved/i.test(cardTimeout.text) && /Pull this patient’s chart/.test(cardTimeout.text),
      'the stalled chart-card read did not leave an actionable partial terminal');
    await cardTimeoutPage.close();

    console.log('PASS Athena auto-pull terminal receipt: real-source VM rejects lossy/non-plain receipt values, immutable accepted-fingerprint binding refuses Date/NaN/undefined/function/sparse and ordinary ABA races, unchanged R1 succeeds, each owned pull has one writer, watchdogs settle, and late results cannot resurrect busy/saving state');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
