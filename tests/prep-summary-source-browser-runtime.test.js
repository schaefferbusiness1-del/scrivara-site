'use strict';

/*
 * SOURCE provenance is a visible Easy Prep contract, not just a pure helper
 * contract.  Boot the shipped /1p shell, load its real bundle, seed one
 * synthetic patient, and read the text painted into #mlsEpSummaryBox.
 *
 * This deliberately does not call buildPrepSummaryForPatient() from the test:
 * the assertions observe the real renderProfile() wrapper and the actual DOM
 * row a clinician sees.  No network, Athena session, or real patient data is
 * used.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let requestPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
      if (requestPath === '/') requestPath = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + requestPath);
      const relative = path.relative(root, file);
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        res.writeHead(403); res.end(); return;
      }
      fs.readFile(file, (err, body) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function runtime() {
  const { server, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const localOrigin = `http://127.0.0.1:${port}`;
  page.on('pageerror', (err) => errors.push(String(err && err.message || err).slice(0, 240)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`.slice(0, 240));
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(localOrigin)) errors.push(`request failed: ${request.url()}`.slice(0, 240));
  });
  page.on('response', (response) => {
    if (response.url().startsWith(localOrigin) && response.status() >= 400) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`.slice(0, 240));
    }
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      if (typeof window.__mlsEnsureUiBundle === 'function') window.__mlsEnsureUiBundle();
    });
    await page.waitForFunction(() => !!window.__mlsEasyPrep && typeof window.renderProfile === 'function', null,
      { timeout: 20000 });
    await page.evaluate(() => {
      const auth = document.getElementById('authScreen');
      const app = document.getElementById('appScreen');
      if (auth) auth.style.display = 'none';
      if (app) app.style.display = '';
      window.__mlsHarnessAccountEmail = 'prep-source-browser@mlsscribe.test';
    });

    const result = await page.evaluate(() => {
      const base = {
        name: 'Source Browser Synthetic', dob: '1970-01-02', mrn: 'SYN-900001',
        problems: 'Synthetic problem', meds: 'Synthetic medication', allergies: 'Synthetic allergy',
        visits: []
      };

      function paint(id, patch) {
        const next = Object.assign({}, base, patch || {}, { id });
        savePatients([next]);
        setActivePtId(id);
        if (typeof showView === 'function') showView('patients');
        renderPatients();
        renderProfile();
        window.__mlsEasyPrep.render();
        const body = document.querySelector('#mlsEpSummaryBox .body');
        return body ? String(body.textContent || '') : '';
      }

      const fullId = 'prep-source-browser-full';
      const partialId = 'prep-source-browser-partial';

      return {
        manual: paint('prep-source-browser-manual', {}),
        full: paint(fullId, {
          athenaProfileCoverage: {
            complete: true, exactIdentityVerified: true, patientId: fullId,
            capturedAt: '2026-08-24T14:15:16.000Z',
            cards: { problems: { status: 'found' }, meds: { status: 'found' } }
          }
        }),
        partial: paint(partialId, {
          athenaProfileCoverage: undefined,
          athenaPartialProfileCoverage: {
            kind: 'athena-partial-profile-coverage', complete: false,
            exactIdentityVerified: true, patientId: partialId,
            capturedAt: '2026-08-24T15:00:00.000Z', identityProof: 'name-dob',
            fields: { problems: { status: 'found', count: 1 }, meds: { status: 'found', count: 1 } }
          }
        }),
        wrongPatientLegacy: paint('prep-source-browser-wrong', {
          athenaPartialProfileCoverage: undefined,
          athenaProfileCoverage: {
            complete: true, exactIdentityVerified: true, patientId: 'different-synthetic-patient',
            capturedAt: '2026-08-24T16:00:00.000Z'
          },
          athenaChartImportedAt: '2026-08-20T09:00:00.000Z'
        }),
        snapshotOnly: paint('prep-source-browser-snapshot', {
          athenaProfileCoverage: undefined,
          athenaChartImportedAt: undefined,
          athenaChartSnapshot: JSON.stringify({ problems: ['Snapshot-only problem'] })
        }),
        verifiedHistory: paint('prep-source-browser-history', {
          visits: [{
            date: '2026-08-24', source: 'athena-copy', raw: 'Verified encounter body.',
            identityVerified: true, identityBinding: 'prep-source-browser-history',
            fullDetail: true, bodyComplete: true, indexOnly: false
          }]
        }),
        legacyStampOnly: paint('prep-source-browser-legacy', {
          athenaChartImportedAt: '2026-08-20T09:00:00.000Z'
        }),
        resolvedVisits: paint('prep-source-browser-visits', {
          visits: [
            { date: '2026-08-24', source: 'athena-visit', raw: 'Assessment: newest Athena encounter.' },
            { date: '2026-08-20', source: 'athena-visit', raw: 'Assessment: encounter two.' },
            { date: '2026-08-15', source: 'athena-visit', raw: 'Assessment: encounter three.' },
            { date: '2026-08-10', source: 'athena-visit', raw: 'Assessment: encounter four.' },
            { date: '2026-08-05', source: 'athena-visit', raw: 'Assessment: encounter five.' },
            { date: '2026-07-25', source: 'athena-visit', raw: 'Assessment: encounter six.' },
            { date: '2026-07-15', source: 'athena-visit', raw: 'Assessment: encounter seven.' },
            { date: '2026-07-05', source: 'athena-visit', raw: 'Assessment: encounter eight.' },
            { date: '2026-06-25', source: 'athena-visit', raw: 'Assessment: encounter nine.' }
          ]
        })
      };
    });

    assert.match(result.manual,
      /SOURCE: CLINICAL DATA PRESENT — no identity-verified Athena pull receipt is attached/,
      'clinical facts without a receipt were falsely described as no pull/data at all');
    assert.doesNotMatch(result.manual, /SOURCE: (?:PULLED|NOT PULLED) from Athena/,
      'unverified clinical facts were collapsed into a false binary provenance claim');
    assert.match(result.full, /SOURCE: PULLED from Athena — identity-verified chart receipt from 2026-08-24/,
      'a complete exact-patient receipt did not repaint the visible SOURCE row as PULLED');
    assert.doesNotMatch(result.full, /SOURCE: NOT PULLED/);
    assert.match(result.partial, /SOURCE: PARTIALLY PULLED from Athena — identity-verified capture from 2026-08-24/,
      'an exact-patient partial receipt did not repaint the visible SOURCE row as PARTIALLY PULLED');
    assert.match(result.wrongPatientLegacy,
      /SOURCE: ATHENA RECEIPT REJECTED — the stored pull receipt is bound to a different patient/,
      'wrong-patient proof must fail closed with the actual identity reason');
    assert.match(result.snapshotOnly,
      /SOURCE: CLINICAL DATA PRESENT — no identity-verified Athena pull receipt is attached/,
      'snapshot contents without a receipt must be shown as unverified data, not a false pulled/not-pulled claim');
    assert.match(result.verifiedHistory,
      /SOURCE: VISIT HISTORY PULLED from Athena — exact-patient verified receipt from 2026-08-24 \(1 verified visit\)/,
      'exact-patient verified visit history still rendered as NOT PULLED');
    assert.doesNotMatch(result.verifiedHistory, /SOURCE: NOT PULLED/);
    assert.match(result.legacyStampOnly,
      /SOURCE: LEGACY ATHENA IMPORT STAMP PRESENT from 2026-08-20 — this older record has no identity-verified pull receipt/,
      'a legacy timestamp without an identity receipt was presented as verified');
    assert.doesNotMatch(result.legacyStampOnly, /SOURCE: PULLED from Athena/);
    assert.match(result.resolvedVisits, /LAST VISIT: 9 visits on file, last seen 2026-08-24/,
      'the visible prep card contradicted the profile resolver with "No prior visits"');
    assert.match(result.resolvedVisits, /Assessment: newest Athena encounter\./,
      'the visible prep card did not use the canonical newest encounter body');
    assert.doesNotMatch(result.resolvedVisits, /LAST VISIT: No prior visits on file/,
      'the old patientNotes-only empty state is still visible for a pulled chart');

    assert.strictEqual(errors.length, 0, `shipped SOURCE-row browser flow raised page errors: ${errors.join(' | ')}`);
    console.log('prep-summary-source-browser-runtime: 7 visible SOURCE states passed + canonical 9-visit state passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

runtime().catch((err) => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
