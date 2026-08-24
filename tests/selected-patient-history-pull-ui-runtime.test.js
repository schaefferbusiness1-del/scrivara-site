'use strict';

/* The open-patient profile used to show two competing Athena pulls: the
 * patient-list toolbar action and a full-history action above the profile.
 * This drives the real feat_visits.js UI owner in Chromium and proves that the
 * existing full-history action has one DOM owner, lives in the visible Visit
 * history header, tells a complete history from a partial one, and returns the
 * toolbar action exactly when the patient selection is cleared. No pull is
 * executed and no patient data leaves this synthetic page. */

const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html><head></head><body>
      <button id="ptPullAthenaBtn" style="display:inline-flex">Pull the open patient in Athena</button>
      <section id="profileCard">
        <div id="mlsVisitHistoryExt">
          <div class="mlsxh-head"><div class="mlsxh-title">Visit history</div></div>
        </div>
      </section>
    </body></html>`);

    await page.evaluate(() => {
      window.__activeSyntheticPatient = {
        id: 'patient-complete', name: 'Synthetic Complete', dob: '01/01/1970', updated: 1,
        visits: [{
          id: 'visit-complete', source: 'athena-visits', fullDetail: true,
          bodyComplete: true, indexOnly: false, raw: 'Synthetic complete encounter body.'
        }]
      };
      window.activePatient = () => window.__activeSyntheticPatient;
      window.getPatients = () => window.__activeSyntheticPatient ? [window.__activeSyntheticPatient] : [];
      window.findPatient = id => window.__activeSyntheticPatient && String(window.__activeSyntheticPatient.id) === String(id)
        ? window.__activeSyntheticPatient : null;
      window.upsertPatient = () => true;
      window.savePatients = () => true;
    });

    await page.addScriptTag({ path: path.join(root, 'feat_visits.js') });
    await page.waitForFunction(() => window.__mlsCopyVisits && typeof window.__mlsCopyVisits._ensureBar === 'function');

    const complete = await page.evaluate(() => {
      const api = window.__mlsCopyVisits;
      api._ensureBar();
      const first = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn');
      api._ensureBar(); api._ensureBar();
      const second = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn');
      const toolbar = document.getElementById('ptPullAthenaBtn');
      return {
        bars: document.querySelectorAll('#mlsCopyVisitsBar').length,
        primaryButtons: document.querySelectorAll('#mlsCopyVisitsBar .mls-cv-btn').length,
        sameButton: first === second,
        label: second && second.textContent,
        readOnlyText: document.querySelector('#mlsCopyVisitsBar .mls-cv-readonly') && document.querySelector('#mlsCopyVisitsBar .mls-cv-readonly').textContent,
        readOnlyAriaHidden: document.querySelector('#mlsCopyVisitsBar .mls-cv-readonly') && document.querySelector('#mlsCopyVisitsBar .mls-cv-readonly').getAttribute('aria-hidden'),
        parentClass: second && second.parentElement && second.parentElement.parentElement.className,
        toolbarHidden: toolbar.hidden && getComputedStyle(toolbar).display === 'none',
        ownedHide: toolbar.getAttribute('data-mls-visits-selected-hide')
      };
    });
    assert.deepStrictEqual(complete, {
      bars: 1,
      primaryButtons: 1,
      sameButton: true,
      label: 'Refresh full visit history',
      readOnlyText: 'READ-ONLY',
      readOnlyAriaHidden: 'true',
      parentClass: 'mlsxh-head',
      toolbarHidden: true,
      ownedHide: '1'
    }, 'a complete selected chart must have one stable primary history action in the Visit history header');

    const partialVisit = await page.evaluate(() => {
      window.__mlsSinglePullVisits = null;
      window.__activeSyntheticPatient = {
        id: 'patient-index', name: 'Synthetic Index', dob: '02/02/1970', updated: 2,
        visits: [{ id: 'visit-index', source: 'athena-visits', indexOnly: true, raw: '' }]
      };
      window.dispatchEvent(new CustomEvent('mls:active-patient-changed', { detail: { patientId: 'patient-index' } }));
      window.__mlsCopyVisits._ensureBar();
      return {
        label: document.querySelector('#mlsCopyVisitsBar .mls-cv-btn').textContent,
        bars: document.querySelectorAll('#mlsCopyVisitsBar').length
      };
    });
    assert.strictEqual(partialVisit.label, 'Retry missing visit details', 'an Athena index shell must name the retry action');
    assert.strictEqual(partialVisit.bars, 1, 'patient switching must not duplicate the existing history action');

    const receiptScoped = await page.evaluate(() => {
      window.__activeSyntheticPatient = {
        id: 'patient-receipt', name: 'Synthetic Receipt', dob: '03/03/1970', updated: 3,
        visits: [{
          id: 'visit-receipt-complete', source: 'athena-copy', fullDetail: true,
          bodyComplete: true, indexOnly: false, raw: 'Synthetic complete encounter body.'
        }]
      };
      window.__mlsSinglePullVisits = { patientId: 'patient-receipt', ok: false, reason: 'reader-failed' };
      window.__mlsCopyVisits._ensureBar();
      const mine = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn').textContent;
      window.__mlsSinglePullVisits = { patientId: 'another-patient', ok: false, reason: 'reader-failed' };
      window.__mlsCopyVisits._ensureBar();
      const another = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn').textContent;
      return { mine, another };
    });
    assert.strictEqual(receiptScoped.mine, 'Retry missing visit details', 'this patient\'s partial single-pull receipt must name the retry');
    assert.strictEqual(receiptScoped.another, 'Refresh full visit history', 'another patient\'s receipt must not leak into this chart');

    /* A visit-reader run announces itself with exactly one mlsPing before any
       Athena work. Count that real boundary while stubbing only the preference
       resolver: OFF and an unset->OFF choice must emit zero; ON must emit one. */
    const offClick = await page.evaluate(async () => {
      let starts = 0, ensureCalls = 0, directWrites = 0;
      const hear = event => { if (event.data && event.data.type === 'mlsPing') starts++; };
      window.addEventListener('message', hear);
      window.__mlsVisitNotesPref = {
        read: () => ({ state: 'off', on: false, settled: true }),
        write: () => { directWrites++; return true; },
        ensureChosenForBulkPull: () => { ensureCalls++; return Promise.resolve({ ok: true, on: true }); }
      };
      const button = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn');
      button.click();
      await new Promise(resolve => setTimeout(resolve, 40));
      window.removeEventListener('message', hear);
      return {
        starts, ensureCalls, directWrites, disabled: button.disabled,
        status: document.querySelector('#mlsCopyVisitsBar .mls-cv-status').textContent
      };
    });
    assert.strictEqual(offClick.starts, 0, 'explicit Full Notes OFF still invoked the visit reader');
    assert.strictEqual(offClick.ensureCalls, 0, 'explicit OFF unnecessarily opened the first-use choice');
    assert.strictEqual(offClick.directWrites, 0, 'the header action mutated an explicit OFF preference');
    assert.strictEqual(offClick.disabled, false, 'the OFF refusal left the header action disabled');
    assert.strictEqual(offClick.status,
      'Full visit notes are OFF. Enable Full visit notes in Settings before refreshing this history.',
      'the OFF refusal did not tell the clinician exactly how to enable the reader');

    const unsetOffClick = await page.evaluate(async () => {
      let starts = 0, ensureCalls = 0, current = { state: 'unset', on: true, settled: true };
      const hear = event => { if (event.data && event.data.type === 'mlsPing') starts++; };
      window.addEventListener('message', hear);
      window.__mlsVisitNotesPref = {
        read: () => current,
        ensureChosenForBulkPull: () => {
          ensureCalls++;
          current = { state: 'off', on: false, settled: true };
          return Promise.resolve({ ok: true, chosen: true, on: false, reason: 'choice-saved' });
        }
      };
      const button = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn');
      button.click();
      await new Promise(resolve => setTimeout(resolve, 40));
      window.removeEventListener('message', hear);
      return {
        starts, ensureCalls, disabled: button.disabled,
        status: document.querySelector('#mlsCopyVisitsBar .mls-cv-status').textContent
      };
    });
    assert.strictEqual(unsetOffClick.ensureCalls, 1, 'an unset preference did not use the one first-use choice resolver');
    assert.strictEqual(unsetOffClick.starts, 0, 'an unset preference confirmed OFF still invoked the visit reader');
    assert.strictEqual(unsetOffClick.disabled, false, 'the unset->OFF refusal left the header action disabled');
    assert.strictEqual(unsetOffClick.status,
      'Full visit notes are OFF. Enable Full visit notes in Settings before refreshing this history.',
      'the unset->OFF answer did not leave a clear Settings remedy');

    const switchedDuringChoice = await page.evaluate(async () => {
      let starts = 0, releaseChoice;
      let current = { state: 'unset', on: true, settled: true };
      window.__activeSyntheticPatient = {
        id: 'patient-choice-a', name: 'Synthetic Choice A', dob: '05/05/1970', updated: 5, visits: []
      };
      window.__mlsCopyVisits._ensureBar();
      const hear = event => { if (event.data && event.data.type === 'mlsPing') starts++; };
      window.addEventListener('message', hear);
      window.__mlsVisitNotesPref = {
        read: () => current,
        ensureChosenForBulkPull: () => new Promise(resolve => { releaseChoice = resolve; })
      };
      const button = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn');
      button.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      window.__activeSyntheticPatient = {
        id: 'patient-choice-b', name: 'Synthetic Choice B', dob: '06/06/1970', updated: 6, visits: []
      };
      window.dispatchEvent(new CustomEvent('mls:active-patient-changed', { detail: { patientId: 'patient-choice-b' } }));
      current = { state: 'on', on: true, settled: true };
      releaseChoice({ ok: true, chosen: true, on: true, reason: 'choice-saved' });
      await new Promise(resolve => setTimeout(resolve, 40));
      window.removeEventListener('message', hear);
      return { starts, disabled: button.disabled };
    });
    assert.strictEqual(switchedDuringChoice.starts, 0,
      'an ON answer completed after a patient switch and silently retargeted the visit reader');
    assert.strictEqual(switchedDuringChoice.disabled, false,
      'the patient-switch safety stop left the shared header action disabled');

    const onClick = await page.evaluate(async () => {
      let starts = 0, ensureCalls = 0;
      const hear = event => {
        if (!event.data || event.data.type !== 'mlsPing') return;
        starts++;
        window.postMessage({ type: 'mlsPong' }, '*');
      };
      window.addEventListener('message', hear);
      window.__mlsVisitNotesPref = {
        read: () => ({ state: 'on', on: true, settled: true }),
        ensureChosenForBulkPull: () => { ensureCalls++; return Promise.resolve({ ok: true, on: true }); }
      };
      const button = document.querySelector('#mlsCopyVisitsBar .mls-cv-btn');
      button.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      window.removeEventListener('message', hear);
      return { starts, ensureCalls, disabled: button.disabled };
    });
    assert.strictEqual(onClick.starts, 1, 'Full Notes ON did not invoke the one existing visit reader exactly once');
    assert.strictEqual(onClick.ensureCalls, 0, 'an explicit ON preference unnecessarily opened the first-use choice');
    assert.strictEqual(onClick.disabled, false, 'the ON run/refusal did not restore the header action');

    const cleared = await page.evaluate(() => {
      window.__activeSyntheticPatient = null;
      window.dispatchEvent(new CustomEvent('mls:active-patient-changed', { detail: {} }));
      window.__mlsCopyVisits._ensureBar();
      const toolbar = document.getElementById('ptPullAthenaBtn');
      return {
        barPresent: !!document.getElementById('mlsCopyVisitsBar'),
        toolbarHidden: toolbar.hidden,
        inlineDisplay: toolbar.style.getPropertyValue('display'),
        computedDisplay: getComputedStyle(toolbar).display,
        ownedHide: toolbar.hasAttribute('data-mls-visits-selected-hide')
      };
    });
    assert.deepStrictEqual(cleared, {
      barPresent: false,
      toolbarHidden: false,
      inlineDisplay: 'inline-flex',
      computedDisplay: 'inline-flex',
      ownedHide: false
    }, 'clearing the patient must remove the selected-chart action and restore the prior toolbar action exactly');

    const remounted = await page.evaluate(() => {
      window.__activeSyntheticPatient = {
        id: 'patient-remount', name: 'Synthetic Remount', dob: '04/04/1970', updated: 4,
        visits: []
      };
      const section = document.getElementById('mlsVisitHistoryExt');
      section.innerHTML = '<div class="mlsxh-head"><div class="mlsxh-title">Visit history</div></div>';
      window.__mlsCopyVisits._ensureBar();
      return {
        bars: document.querySelectorAll('#mlsCopyVisitsBar').length,
        inHeader: !!document.querySelector('#mlsVisitHistoryExt .mlsxh-head > #mlsCopyVisitsBar'),
        toolbarHidden: getComputedStyle(document.getElementById('ptPullAthenaBtn')).display === 'none'
      };
    });
    assert.deepStrictEqual(remounted, { bars: 1, inHeader: true, toolbarHidden: true },
      'a rebuilt history header must reacquire exactly one existing-engine action');

    console.log('PASS selected-patient history pull UI: one header owner, honest labels, Full Notes click admission, exact patient scoping, and toolbar reappearance');
  } finally {
    await browser.close();
  }
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
