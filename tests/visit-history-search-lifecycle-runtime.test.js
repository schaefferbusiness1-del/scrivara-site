'use strict';

/* The Visit-history search is a live clinical input. Background visit filings
 * may refresh its section, but must not interrupt same-patient typing; account
 * boundaries must do the opposite and forget every prior filter. This drives
 * the shipped owner in real Chrome with synthetic patients only. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_visit_history_ext.js'), 'utf8');
let checks = 0;
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function ok(value, message) { assert.ok(value, message); checks++; }

ok(source.includes('S(p.id) === S(_lastPid)'), 'focus restoration is not exact-patient bound');
ok(source.includes('oldSec.contains(activeEl)'), 'focus restoration is not owned by the Visit-history section');
ok(source.includes('nextSearch.focus({ preventScroll: true })'), 'same-patient rebuild no longer restores search focus safely');
ok(source.includes('nextSearch.setSelectionRange(focusRestore.start, focusRestore.end'), 'same-patient rebuild no longer restores the caret/selection');
ok(source.includes('Object.keys(state).forEach(function (pid) { delete state[pid]; });'), 'session filter state is reassigned or retained instead of cleared in place');
ok(source.includes('_onSession = function () { try { clearState(); }'), 'session boundary does not clear Visit-history filter memory');
eq(source.split('Search visits (dx, CPT, meds, findings, plan…').length - 1, 1, 'search copy or control count changed');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.setContent('<!doctype html><html><head></head><body><div id="profileCard"><div id="profAtGlance"></div><div id="mlsVisitHistory"></div></div></body></html>');
    await page.evaluate(() => {
      window.__visitPatients = {
        a: { id: 'a', visits: [{ id: 'a-1', date: '2026-08-20', type: 'Office visit', raw: 'gabapentin plan' }] },
        b: { id: 'b', visits: [{ id: 'b-1', date: '2026-08-19', type: 'Office visit', raw: 'other finding' }] }
      };
      window.__visitActive = 'a';
      window.activePatient = () => window.__visitPatients[window.__visitActive] || null;
      window.getActivePtId = () => window.__visitActive;
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
    await page.waitForSelector('.mlsxh-search');

    const typed = await page.evaluate(() => {
      const search = document.querySelector('.mlsxh-search');
      window.__firstVisitSearch = search;
      search.focus();
      search.value = 'gab';
      search.setSelectionRange(1, 3, 'forward');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        value: search.value,
        focused: document.activeElement === search,
        start: search.selectionStart,
        end: search.selectionEnd,
        cards: document.querySelectorAll('.mlsxh-card').length
      };
    });
    eq(typed.value, 'gab', 'input handler changed typed search text');
    eq(typed.focused, true, 'input handler dropped focus synchronously');
    eq(typed.start, 1, 'input handler moved the selection start');
    eq(typed.end, 3, 'input handler moved the selection end');
    eq(typed.cards, 1, 'synthetic search did not exercise the filtered list');

    /* List replacement wakes the scoped observer. An unchanged data signature
       must return without replacing the control. */
    await page.waitForTimeout(400);
    const settled = await page.evaluate(() => {
      const search = document.querySelector('.mlsxh-search');
      return {
        same: search === window.__firstVisitSearch,
        value: search.value,
        focused: document.activeElement === search,
        start: search.selectionStart,
        end: search.selectionEnd
      };
    });
    eq(settled.same, true, 'ordinary search/list mutations replaced the search control');
    eq(settled.value, 'gab', 'ordinary observer settling cleared search text');
    eq(settled.focused, true, 'ordinary observer settling dropped focus');
    eq(settled.start, 1, 'ordinary observer settling moved the selection start');
    eq(settled.end, 3, 'ordinary observer settling moved the selection end');

    /* A same-patient background filing changes dataSig, so the current renderer
       legitimately replaces the section. Value, focus and caret must survive. */
    await page.evaluate(() => {
      window.__visitPatients.a.visits[0].raw = 'changed gabapentin plan';
      document.getElementById('profileCard').appendChild(document.createElement('i'));
    });
    await page.waitForFunction(() => document.querySelector('.mlsxh-search') !== window.__firstVisitSearch);
    await page.waitForTimeout(350);
    const refreshed = await page.evaluate(() => {
      const search = document.querySelector('.mlsxh-search');
      return {
        value: search.value,
        focused: document.activeElement === search,
        start: search.selectionStart,
        end: search.selectionEnd,
        state: window.__mlsVisitHistoryExt._state.a.q
      };
    });
    eq(refreshed.value, 'gab', 'same-patient data refresh cleared search text');
    eq(refreshed.state, 'gab', 'same-patient data refresh lost its filter state');
    eq(refreshed.focused, true, 'same-patient data refresh dropped search focus');
    eq(refreshed.start, 1, 'same-patient data refresh moved the selection start');
    eq(refreshed.end, 3, 'same-patient data refresh moved the selection end');

    /* Patient changes are ownership boundaries: B starts with B's filter, while
       returning to A may restore A's per-patient filter within this account. */
    const patientRoundTrip = await page.evaluate(() => {
      window.__visitActive = 'b';
      window.dispatchEvent(new CustomEvent('mls:active-patient-changed', { detail: { previousId: 'a', patientId: 'b' } }));
      const b = document.querySelector('.mlsxh-search');
      const bValue = b.value;
      const bFocused = document.activeElement === b;
      window.__visitActive = 'a';
      window.dispatchEvent(new CustomEvent('mls:active-patient-changed', { detail: { previousId: 'b', patientId: 'a' } }));
      const a = document.querySelector('.mlsxh-search');
      return { bValue, bFocused, aValue: a.value, aFocused: document.activeElement === a };
    });
    eq(patientRoundTrip.bValue, '', 'patient B inherited patient A search text');
    eq(patientRoundTrip.bFocused, false, 'patient switch carried focus into the new chart');
    eq(patientRoundTrip.aValue, 'gab', 'same-account return did not restore patient A filter');
    eq(patientRoundTrip.aFocused, false, 'patient switch back incorrectly stole focus');

    /* The same immutable id can exist under another account. Session cleanup
       must retain the exported object identity but delete its PHI-bearing keys. */
    const boundary = await page.evaluate(() => {
      const stateRef = window.__mlsVisitHistoryExt._state;
      window.__visitActive = '';
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { nextAccount: 'synthetic-b' } }));
      const afterClear = {
        sameStateObject: window.__mlsVisitHistoryExt._state === stateRef,
        keys: Object.keys(stateRef),
        sectionPresent: !!document.getElementById('mlsVisitHistoryExt')
      };
      window.__visitActive = 'a';
      window.__mlsVisitHistoryExt.rebuild(true);
      const nextSearch = document.querySelector('.mlsxh-search');
      return {
        sameStateObject: afterClear.sameStateObject,
        keys: afterClear.keys,
        sectionPresent: afterClear.sectionPresent,
        nextValue: nextSearch && nextSearch.value,
        nextFocused: document.activeElement === nextSearch
      };
    });
    eq(boundary.sameStateObject, true, 'session cleanup replaced the exported diagnostic state object');
    eq(boundary.keys.length, 0, 'session cleanup retained a prior-patient filter key');
    eq(boundary.sectionPresent, false, 'session cleanup retained the prior-account Visit history DOM');
    eq(boundary.nextValue, '', 'same-id next-account chart inherited prior-account search text');
    eq(boundary.nextFocused, false, 'same-id next-account chart inherited prior-account search focus');

    console.log(`PASS Visit-history search lifecycle: ${checks} checks; same-patient refresh preserves typing/caret, patient and session boundaries remain exact`);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
