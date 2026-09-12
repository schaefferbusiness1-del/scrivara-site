'use strict';

/* The legacy Patients toolbar is rebuilt by the app after the Study module's
 * finite boot poll can finish. Execute the real launch-button slice in a
 * browser and prove a later toolbar replacement restores exactly one button. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const connector = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const moduleMark = connector.indexOf('/* ---- module: feat_study.js ---- */');
const start = connector.indexOf('(function(){', moduleMark);
const end = connector.indexOf('/* ---- module: feat_tab_memory.js ---- */', start);
assert(moduleMark >= 0 && start > moduleMark && end > start, 'could not isolate the real Study module');
const study = connector.slice(start, end);

function html() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="appWrap"><main id="patientsView"><div id="patientsToolbar"><button id="ptPullAthenaBtn" type="button">Pull</button></div></main></main>
    <script>
      window.__mlsSessionEpoch = 1;
      window.__mlsSessionAccount = 'study-launch@example.test';
      window.bkToken = function () { return 'study-launch-token'; };
      window.getPatients = function () { return []; };
      window.findPatient = function () { return null; };
    </script>
    <script src="/study.js"></script>
  </body></html>`;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (pathname === '/study.js') {
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        return res.end(study);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html());
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' });
    await page.waitForSelector('#mlsStudyLaunch');

    const before = await page.evaluate(() => document.querySelectorAll('#mlsStudyLaunch').length);
    assert.strictEqual(before, 1, 'initial Patients toolbar injection did not create exactly one Study / Import button');

    await page.evaluate(() => {
      const oldToolbar = document.getElementById('patientsToolbar');
      const newToolbar = document.createElement('div');
      newToolbar.id = 'patientsToolbar';
      const anchor = document.createElement('button');
      anchor.id = 'ptPullAthenaBtn';
      anchor.type = 'button';
      anchor.textContent = 'Pull after late rebuild';
      newToolbar.appendChild(anchor);
      oldToolbar.replaceWith(newToolbar);
    });
    await page.waitForSelector('#patientsToolbar #mlsStudyLaunch');
    await page.waitForTimeout(50);
    const after = await page.evaluate(() => ({
      count: document.querySelectorAll('#mlsStudyLaunch').length,
      label: document.getElementById('mlsStudyLaunch').textContent,
      nextToAnchor: document.getElementById('ptPullAthenaBtn').nextElementSibling &&
        document.getElementById('ptPullAthenaBtn').nextElementSibling.id === 'mlsStudyLaunch'
    }));
    assert.strictEqual(after.count, 1, 'late toolbar rebuild created duplicate Study / Import buttons');
    assert.strictEqual(after.label, '🧪 Study / Import', 'late toolbar rebuild restored the wrong launch label');
    assert.strictEqual(after.nextToAnchor, true, 'late toolbar rebuild did not restore the launch button beside the pull anchor');

    await page.evaluate(() => {
      const oldView = document.getElementById('patientsView');
      const newView = document.createElement('main');
      newView.id = 'patientsView';
      const toolbar = document.createElement('div');
      toolbar.id = 'patientsToolbar';
      const anchor = document.createElement('button');
      anchor.id = 'ptPullAthenaBtn';
      anchor.type = 'button';
      anchor.textContent = 'Pull after full view replacement';
      toolbar.appendChild(anchor);
      newView.appendChild(toolbar);
      oldView.replaceWith(newView);
    });
    await page.waitForSelector('#patientsView #mlsStudyLaunch');
    const afterViewReplacement = await page.evaluate(() => ({
      count: document.querySelectorAll('#patientsView #mlsStudyLaunch').length,
      nextToAnchor: document.getElementById('ptPullAthenaBtn').nextElementSibling &&
        document.getElementById('ptPullAthenaBtn').nextElementSibling.id === 'mlsStudyLaunch'
    }));
    assert.strictEqual(afterViewReplacement.count, 1, 'full Patients view replacement did not restore exactly one Study / Import button');
    assert.strictEqual(afterViewReplacement.nextToAnchor, true, 'full Patients view replacement did not restore adjacency');

    await page.evaluate(() => document.getElementById('patientsView').appendChild(document.createElement('span')));
    await page.waitForTimeout(50);
    assert.strictEqual(await page.locator('#mlsStudyLaunch').count(), 1, 'unrelated Patients mutations were not idempotent');

    /* A logout/account rollover invalidates the observer receipt. Its old
       toolbar/view callbacks must not recreate a launch button, while a
       subsequent valid session gets a fresh binding and recovers normally. */
    await page.evaluate(() => {
      window.__mlsSessionEpoch = 0;
      window.__mlsSessionAccount = '';
      window.bkToken = function () { return ''; };
      window.__mlsStudy._sessionBoundary();
      const oldView = document.getElementById('patientsView');
      const newView = document.createElement('main');
      newView.id = 'patientsView';
      const toolbar = document.createElement('div');
      toolbar.id = 'patientsToolbar';
      const anchor = document.createElement('button');
      anchor.id = 'ptPullAthenaBtn';
      anchor.type = 'button';
      anchor.textContent = 'Pull after logout';
      toolbar.appendChild(anchor);
      newView.appendChild(toolbar);
      oldView.replaceWith(newView);
    });
    await page.waitForTimeout(100);
    assert.strictEqual(await page.locator('#mlsStudyLaunch').count(), 0, 'logout/session rollover allowed a stale observer to recreate a ghost Study button');

    await page.evaluate(() => {
      window.__mlsSessionEpoch = 2;
      window.__mlsSessionAccount = 'new-study-launch@example.test';
      window.bkToken = function () { return 'new-study-launch-token'; };
      window.__mlsStudy._sessionBoundary();
    });
    await page.waitForSelector('#patientsView #mlsStudyLaunch');
    assert.strictEqual(await page.locator('#mlsStudyLaunch').count(), 1, 'newly current Study session did not recover its launch button');

    await page.evaluate(() => {
      const oldView = document.getElementById('patientsView');
      const newView = document.createElement('main');
      newView.id = 'patientsView';
      const toolbar = document.createElement('div');
      toolbar.id = 'patientsToolbar';
      const anchor = document.createElement('button');
      anchor.id = 'ptPullAthenaBtn';
      anchor.type = 'button';
      anchor.textContent = 'Pull after new session';
      toolbar.appendChild(anchor);
      newView.appendChild(toolbar);
      oldView.replaceWith(newView);
    });
    await page.waitForSelector('#patientsView #mlsStudyLaunch');
    assert.strictEqual(await page.locator('#mlsStudyLaunch').count(), 1, 'new current session did not recover after a later Patients view replacement');
    console.log('PASS legacy Study / Import launch observer runtime: late toolbar rebuild restores one adjacent button');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
