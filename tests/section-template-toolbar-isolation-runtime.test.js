'use strict';

/* Regression for the live Settings failure where feat_mls_uxpack1's generic
 * `[id*=template]` search mounted op-note Upload/Delete controls inside the
 * selected HPI/ROS/Exam/Assessment/Plan saved-format editor.  The two stores
 * are intentionally separate: Settings owns #mlsDtSectionImportOpen and Op
 * Notes owns #templatesModal. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const uxSource = fs.readFileSync(path.join(root, 'feat_mls_uxpack1.js'), 'utf8');
assert.match(uxSource, /ux1-1\.0\.1/, 'template-toolbar isolation version is missing');
assert.match(uxSource, /retireMisplacedTemplateBar/, 'obsolete toolbar retirement is missing');
assert.ok(!/function\s+mountTmplBar\s*\(/.test(uxSource), 'generic template toolbar mounter still exists');
assert.ok(!/querySelectorAll\("\[id\*=template i\]/.test(uxSource), 'generic template-host guessing still exists');

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div id="settingsModal" class="show"><div class="modal">
        <section id="mlsDraftTuningSection">
          <div class="field" id="mlsDtSectionTemplateTextHost" style="height:240px">
            <textarea id="mlsDtSectionTemplateText"></textarea>
            <button id="mlsDtSectionImportOpen">Upload or paste an example for this Assessment section format</button>
            <p id="mlsDtSectionImportScope">Applies only to the selected Assessment section saved format.</p>
            <div id="mlsUx1TmplBar"><button>⬆ Upload templates (.txt/.md)</button></div>
          </div>
        </section>
      </div>
      <div id="templatesModal" style="display:none"><div class="modal">
        <button id="tplNativeUpload">📑 Upload templates (one PDF or many files)</button>
      </div></div>
    </body></html>`);
    await page.evaluate(() => {
      window.getTemplates = () => [];
      window.setTemplates = () => true;
      window.__uxOldReverted = false;
      window.__mlsUxPack1 = {
        installed: true,
        version: 'ux1-1.0.0',
        revert() {
          window.__uxOldReverted = true;
          const bar = document.getElementById('mlsUx1TmplBar');
          if (bar) bar.remove();
          this.installed = false;
        }
      };
    });
    await page.addScriptTag({ path: path.join(root, 'feat_mls_uxpack1.js') });
    await page.waitForTimeout(1750);

    assert.strictEqual(await page.evaluate(() => window.__uxOldReverted), true,
      'same-document upgrade did not retire the old toolbar owner');
    assert.strictEqual(await page.evaluate(() => window.__mlsUxPack1 && window.__mlsUxPack1.version), 'ux1-1.0.1',
      'new isolated owner did not install');
    assert.strictEqual(await page.locator('#mlsUx1TmplBar').count(), 0,
      'op-note toolbar remained or was re-injected into Settings');
    assert.strictEqual(await page.locator('#settingsModal').getByText(/Upload templates \(\.txt\/\.md\)/).count(), 0,
      'Settings still exposes the legacy op-note uploader');
    assert.strictEqual(await page.locator('#mlsDtSectionImportOpen').count(), 1,
      'the section-specific example importer was removed with the obsolete toolbar');
    assert.match(await page.textContent('#mlsDtSectionImportOpen') || '', /Assessment section format/i,
      'the selected-section importer lost its explicit scope');
    assert.strictEqual(await page.locator('#tplNativeUpload').count(), 1,
      'the native Op Notes template uploader was removed');

    console.log('PASS section template toolbar isolation: Settings keeps only its scoped importer; the obsolete op-note toolbar retires across same-page upgrades');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
