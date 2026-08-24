'use strict';

/* A successful full-history pull writes its terminal receipt into the shared
 * #mlsCopyVisitsBar. The enhanced Visit-history renderer then observes the
 * newly filed visits and rebuilds its header about 140 ms later. This drives
 * that exact lifecycle in Chromium and proves the renderer reparents the same
 * control (receipt and listeners intact) for one patient, while an exact
 * patient switch clears the old patient's receipt. Synthetic data only. */

const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.setContent('<!doctype html><html><head></head><body><div id="profileCard"><div id="profAtGlance"></div><div id="mlsVisitHistory"></div></div></body></html>');
    await page.evaluate(() => {
      window.__receiptPatients = {
        a: { id: 'a', visits: [{ id: 'a-1', date: '2026-08-20', type: 'Office visit', raw: 'first synthetic visit' }] },
        b: { id: 'b', visits: [{ id: 'b-1', date: '2026-08-21', type: 'Office visit', raw: 'other synthetic visit' }] }
      };
      window.__receiptActive = 'a';
      window.activePatient = () => window.__receiptPatients[window.__receiptActive] || null;
      window.getActivePtId = () => window.__receiptActive;
      window.__mlsVisitModel = {
        deriveFromLegacy() {},
        getVisits(patient) { return patient.visits.slice(); },
        usableVisits(patient) { return patient.visits.slice(); },
        _svcToYMD(value) { return value; },
        _cleanVisitTypeForDisplay(value) { return value; }
      };
      window.__mlsVisitDetail = { _fmtDate(value) { return value; } };
    });

    await page.addScriptTag({ path: path.join(root, 'feat_visit_history_ext.js') });
    await page.waitForSelector('#mlsVisitHistoryExt .mlsxh-head');

    const mounted = await page.evaluate(() => {
      const bar = document.createElement('div');
      bar.id = 'mlsCopyVisitsBar';
      const button = document.createElement('button');
      button.className = 'mls-cv-btn';
      button.textContent = 'Refresh full visit history';
      button.addEventListener('click', () => { window.__receiptClicks = (window.__receiptClicks || 0) + 1; });
      const status = document.createElement('span');
      status.className = 'mls-cv-status';
      status.textContent = '✓ Done — 2 visits on file; verified history is summarized and organized into the patient profile.';
      bar.append(button, status);
      document.querySelector('#mlsVisitHistoryExt .mlsxh-head').appendChild(bar);
      window.__receiptBar = bar;
      return document.querySelectorAll('#mlsCopyVisitsBar').length;
    });
    assert.strictEqual(mounted, 1, 'synthetic terminal receipt did not mount under the shipped header');

    /* Filing another visit changes dataSig and a child mutation wakes the real
       140 ms observer path. Before the fix, sec.innerHTML="" destroyed the bar. */
    await page.evaluate(() => {
      window.__receiptPatients.a.visits.push({
        id: 'a-2', date: '2026-08-22', type: 'Office visit', raw: 'second synthetic visit'
      });
      document.getElementById('profileCard').appendChild(document.createElement('i'));
    });
    await page.waitForFunction(() => {
      const count = document.querySelector('#mlsVisitHistoryExt .mlsxh-count');
      return count && /2 visits/.test(count.textContent);
    });
    await page.waitForTimeout(220);

    const samePatient = await page.evaluate(() => {
      const bar = document.getElementById('mlsCopyVisitsBar');
      bar.querySelector('.mls-cv-btn').click();
      return {
        sameNode: bar === window.__receiptBar,
        bars: document.querySelectorAll('#mlsCopyVisitsBar').length,
        inHeader: !!document.querySelector('#mlsVisitHistoryExt .mlsxh-head > #mlsCopyVisitsBar'),
        status: bar.querySelector('.mls-cv-status').textContent,
        clicks: window.__receiptClicks
      };
    });
    assert.strictEqual(samePatient.sameNode, true, 'same-patient header rebuild replaced the shared pull control');
    assert.strictEqual(samePatient.bars, 1, 'same-patient header rebuild duplicated the shared pull control');
    assert.strictEqual(samePatient.inHeader, true, 'same-patient header rebuild did not reparent the pull control into the new header');
    assert.match(samePatient.status, /^✓ Done — 2 visits on file/, 'same-patient header rebuild erased the terminal receipt');
    assert.strictEqual(samePatient.clicks, 1, 'reparenting lost the existing pull-control listener');

    await page.evaluate(() => {
      window.__receiptActive = 'b';
      window.dispatchEvent(new CustomEvent('mls:active-patient-changed', {
        detail: { previousId: 'a', patientId: 'b' }
      }));
    });
    await page.waitForFunction(() => {
      const count = document.querySelector('#mlsVisitHistoryExt .mlsxh-count');
      return count && /1 visit(?:\s|$)/.test(count.textContent);
    });

    const switched = await page.evaluate(() => {
      const bar = document.getElementById('mlsCopyVisitsBar');
      bar.querySelector('.mls-cv-btn').click();
      return {
        sameNode: bar === window.__receiptBar,
        bars: document.querySelectorAll('#mlsCopyVisitsBar').length,
        inHeader: !!document.querySelector('#mlsVisitHistoryExt .mlsxh-head > #mlsCopyVisitsBar'),
        status: bar.querySelector('.mls-cv-status').textContent,
        clicks: window.__receiptClicks
      };
    });
    assert.strictEqual(switched.sameNode, true, 'patient switch needlessly replaced the reusable pull control');
    assert.strictEqual(switched.bars, 1, 'patient switch duplicated the shared pull control');
    assert.strictEqual(switched.inHeader, true, 'patient switch did not retain the one pull-control owner in the current header');
    assert.strictEqual(switched.status, '', 'patient B inherited patient A\'s terminal receipt');
    assert.strictEqual(switched.clicks, 2, 'patient-switch reparenting lost the existing pull-control listener');

    console.log('PASS Visit-history pull receipt lifecycle: same-patient rebuild keeps one exact Done receipt/control; patient switch clears prior receipt');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

