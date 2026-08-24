'use strict';

/*
 * Contract for importing a clinician's example into ONE saved section format.
 * The example is a format reference, not patient evidence: extraction stays
 * in the existing private browser/OCR owner, only a bounded transient result
 * may reach the template-derivation route, and only the explicit Apply action
 * may change the selected account/profile record.  This is intentionally a
 * browser/runtime gate because source-string checks cannot prove Cancel,
 * profile isolation, or that a file input advertises the supported formats.
 *
 * Shared owner contract used by this test:
 *   window.__mlsDraftTuning.exampleImporter(section, profileId)
 *   .extract({ kind: 'draft'|'file'|'image', text?, file? })
 *   .derive(extracted) -> { templateText, instructions }
 *   .preview(derived), .apply(derived), .cancel(), .preview()
 *
 * The importer may call window.__mlsPrivateExampleExtractor for DOCX/PDF/image
 * extraction/OCR.  The test supplies that private owner as a deterministic
 * fixture; the raw example must never be stored in localStorage.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'utf8');
const p1Source = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');
assert.ok(p1Source.length > 0, '1p draft-tuning module is missing');

const CONTROL_IDS = [
  'mlsDtSectionImportOpen',
  'mlsDtSectionImportPanel',
  'mlsDtSectionImportFile',
  'mlsDtSectionImportExample',
  'mlsDtSectionImportDerive',
  'mlsDtSectionImportTemplatePreview',
  'mlsDtSectionImportCommentsPreview',
  'mlsDtSectionImportApply',
  'mlsDtSectionImportCancel',
  'mlsDtSectionImportStatus'
];

// Keep the UI contract visible to code review even before the runtime gate is
// green.  These names are the one shared surface for every section/profile.
for (const id of CONTROL_IDS) {
  assert.ok(source.includes('id="' + id + '"'), 'missing example-import control contract: ' + id);
}
for (const phrase of [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  '/api/section-templates/derive'
]) {
  assert.ok(source.includes(phrase), 'example importer does not advertise required contract: ' + phrase);
}

(async function run() {
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const shell = `<!doctype html><html><body>
    <div id="settingsModal" class="show"><div class="modal">
      <div class="row"><button type="button" onclick="saveSettings()">Save settings</button></div>
    </div></div>
  </body></html>`;
  await page.route('https://mls-import-runtime.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
  await page.goto('https://mls-import-runtime.test/settings');
  await page.evaluate(() => {
    window.uns = key => 'example-import-account::' + key;
    window.saveSettings = function () {};
    window.getGenLength = () => 'standard';
    window.getGenInstr = () => '';
  });
  await page.addScriptTag({ path: path.join(root, 'feat_mls_draft_tuning.js') });
  await page.waitForFunction(() => window.__mlsDraftTuning && document.getElementById('mlsDtFamily'));

  // A fresh family is semantically at defaults. Reset must not be enabled by
  // object-key ordering, and an actual edit/reset must give a visible receipt
  // without persisting anything until the Settings footer is saved.
  assert.ok(await page.locator('#mlsDtReset').isDisabled(), 'Reset is enabled even though SOAP is already at semantic defaults');
  assert.match(await page.textContent('#mlsDtResetStatus') || '', /already using MLS defaults/i,
    'the default Reset state does not explain why the action is unavailable');
  const storageBeforeReset = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])));
  await page.selectOption('#mlsDtLength', 'detailed');
  assert.ok(await page.locator('#mlsDtReset').isEnabled(), 'editing a draft family did not enable Reset');
  await page.click('#mlsDtReset');
  assert.ok(await page.locator('#mlsDtReset').isDisabled(), 'Reset did not return the family to semantic defaults');
  assert.strictEqual(await page.inputValue('#mlsDtLength'), 'standard', 'Reset did not restore the SOAP detail default');
  assert.match(await page.textContent('#mlsDtResetStatus') || '', /restored MLS defaults.*save changes/i,
    'Reset completed without a visible save-required receipt');
  assert.strictEqual(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))), storageBeforeReset,
    'Reset persisted before the Settings footer was saved');

  await page.selectOption('#mlsDtFamily', 'hpi');
  for (const id of CONTROL_IDS) {
    assert.strictEqual(await page.locator('#' + id).count(), 1, 'HPI example control is not mounted: ' + id);
  }
  await page.click('#mlsDtSectionImportOpen');
  assert.strictEqual(await page.getAttribute('#mlsDtSectionImportOpen', 'aria-expanded'), 'true',
    'example importer did not expose its expanded state');
  await page.waitForFunction(() => {
    const panel = document.getElementById('mlsDtSectionImportPanel');
    return panel && getComputedStyle(panel).display !== 'none' && !panel.hidden;
  });
  const importCopy = (await page.textContent('#mlsDtSectionImportPanel') || '').toLowerCase();
  for (const kind of ['draft', 'file', 'image']) {
    assert.ok(importCopy.includes(kind), 'example importer does not offer a ' + kind + ' source');
  }
  const accept = await page.getAttribute('#mlsDtSectionImportFile', 'accept');
  for (const token of ['.txt', '.pdf', '.docx', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
    assert.ok(String(accept).toLowerCase().includes(token), 'file picker does not accept ' + token);
  }

  // The same visible Configure/import action must open for every draft family;
  // previously the controls rendered for all families but the click silently
  // returned outside HPI/ROS/Exam/Assessment/Plan.
  await page.click('#mlsDtSectionImportCancel');
  assert.strictEqual(await page.getAttribute('#mlsDtSectionImportOpen', 'aria-expanded'), 'false',
    'Cancel did not expose the importer as collapsed');
  const familyIds = await page.evaluate(() => window.__mlsDraftTuning.familyIds.slice());
  for (const family of familyIds) {
    await page.selectOption('#mlsDtFamily', family);
    await page.click('#mlsDtSectionImportOpen');
    assert.ok(await page.locator('#mlsDtSectionImportPanel').isVisible(), family + ' Configure/import button did not open');
    await page.click('#mlsDtSectionImportCancel');
  }
  await page.selectOption('#mlsDtFamily', 'hpi');
  await page.click('#mlsDtSectionImportOpen');

  const profileId = await page.evaluate(() => {
    const editor = window.__mlsDraftTuning.profileEditor('hpi');
    const row = editor.add({ id: 'example_hpi', label: 'Example HPI' });
    return row && row.id;
  });
  assert.strictEqual(profileId, 'example_hpi', 'example importer fixture profile was not created');

  const result = await page.evaluate(async ({ profileId }) => {
    const api = window.__mlsDraftTuning;
    const rawExample = 'PATIENT EXAMPLE SHOULD NEVER BE PERSISTED: ' + 'x'.repeat(9000);
    const routeCalls = [];
    const extractorCalls = [];
    window.__mlsPrivateExampleExtractor = async input => {
      extractorCalls.push({ kind: input && input.kind, type: input && input.file && input.file.type });
      return { text: 'EXTRACTED PRIVATE EXAMPLE OUTLINE\nHPI:\nInterval history:\nAssessment:' };
    };
    window.fetch = async (url, options) => {
      routeCalls.push({ url: String(url), body: String(options && options.body || '') });
      return {
        ok: true,
        json: async () => ({
          templateText: 'HPI:\nChief concern:\nInterval history:\nRelevant context:',
          instructions: 'AI comments: preserve chronology, laterality and documented response; never add facts.'
        })
      };
    };
    const importer = api.exampleImporter('hpi', profileId);
    const before = JSON.stringify(api.read());
    const localKeysBefore = Object.keys(localStorage).sort();

    const draft = await importer.extract({ kind: 'draft', text: rawExample });
    const files = [
      ['example.txt', 'text/plain', 'file'],
      ['example.pdf', 'application/pdf', 'file'],
      ['example.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'file'],
      ['example.png', 'image/png', 'image'],
      ['example.jpg', 'image/jpeg', 'image'],
      ['example.webp', 'image/webp', 'image'],
      ['example.gif', 'image/gif', 'image']
    ];
    const extractedFiles = [];
    for (const [name, type, kind] of files) {
      const file = new File(['private example bytes'], name, { type });
      extractedFiles.push(await importer.extract({ kind, file }));
    }
    const derived = await importer.derive(draft);
    const preview = importer.preview(derived);
    const afterPreview = JSON.stringify(api.read());
    const cancelled = importer.cancel();
    const afterCancel = JSON.stringify(api.read());

    // Re-preview and Apply through the explicit boundary only.
    importer.preview(derived);
    const applied = importer.apply(derived);
    const afterApply = api.read();
    const hpi = afterApply.families.hpi;
    const ros = afterApply.families.ros;
    const hpiTarget = hpi.profiles.find(profile => profile.id === profileId);
    const hpiDefault = hpi.profiles.find(profile => profile.id !== profileId);
    return {
      draft,
      extractedFiles,
      derived,
      preview,
      cancelled,
      before,
      afterPreview,
      afterCancel,
      applied,
      target: hpiTarget,
      defaultProfile: hpiDefault,
      ros,
      routeCalls,
      extractorCalls,
      localKeysBefore,
      localKeysAfter: Object.keys(localStorage).sort(),
      localValues: Object.values(localStorage).join('|')
    };
  }, { profileId });

  assert.ok(result.draft && result.draft.text, 'draft example was not extracted');
  assert.ok(result.extractedFiles.every(item => item && item.text), 'one or more file/image examples were not extracted');
  assert.ok(result.extractedFiles.every(item => String(item.text).length <= 12000),
    'extracted example exceeded the transient bound');
  assert.ok(result.extractorCalls.length >= 6, 'PDF/DOCX/image examples did not reuse the private extractor/OCR owner');
  assert.ok(result.routeCalls.length >= 1, 'derived template was not sent through the AI derivation route');
  assert.strictEqual(result.routeCalls[0].url, '/api/section-templates/derive', 'wrong AI template-derivation route');
  assert.ok(result.routeCalls[0].body.length <= 16000, 'AI derivation request was not bounded');
  assert.ok(result.derived.templateText && result.derived.instructions, 'derivation omitted templateText or AI comments');
  assert.ok(result.derived.templateText.length <= 2000, 'derived templateText exceeded the profile bound');
  assert.ok(result.derived.instructions.length <= 600, 'derived AI comments exceeded the profile bound');
  assert.match(result.preview.templateText, /Chief concern/, 'preview did not show derived templateText');
  assert.match(result.preview.instructions, /preserve chronology/, 'preview did not show derived AI comments');
  assert.strictEqual(result.afterPreview, result.before, 'preview mutated account/profile data before Apply');
  assert.strictEqual(result.afterCancel, result.before, 'Cancel did not leave profile data unchanged');
  assert.ok(result.cancelled === true || result.cancelled === false,
    'Cancel did not return an explicit result');
  assert.ok(result.applied, 'Apply did not return an applied profile/result');
  assert.match(result.target.templateText, /Chief concern/, 'Apply did not save derived templateText to the selected profile');
  assert.match(result.target.instructions, /preserve chronology/, 'Apply did not save derived AI comments to the selected profile');
  assert.ok(!result.defaultProfile.templateText.includes('Chief concern'),
    'example import leaked from the selected HPI profile into another HPI profile');
  assert.ok(!JSON.stringify(result.ros).includes('Chief concern'),
    'example import leaked from HPI into ROS');
  assert.ok(!result.localValues.includes('PATIENT EXAMPLE SHOULD NEVER BE PERSISTED'),
    'raw example text was persisted in localStorage');
  assert.deepStrictEqual(result.localKeysAfter, result.localKeysBefore,
    'example import created an unscoped or second persistence key');

  // Apply/Cancel are user-visible actions, not implicit side effects of file
  // selection or derivation.  The preview pane has to expose both actions.
  await page.fill('#mlsDtSectionImportExample', 'Example HPI draft with interval history and documented response.');
  await page.click('#mlsDtSectionImportDerive');
  await page.waitForFunction(() => {
    const preview = document.getElementById('mlsDtSectionImportPreview');
    return preview && getComputedStyle(preview).display !== 'none';
  });
  assert.strictEqual(await page.locator('#mlsDtSectionImportApply').count(), 1, 'Apply control missing');
  assert.strictEqual(await page.locator('#mlsDtSectionImportCancel').count(), 1, 'Cancel control missing');
  assert.ok(await page.locator('#mlsDtSectionImportApply').isVisible(), 'Apply control is not visible');
  assert.ok(await page.locator('#mlsDtSectionImportCancel').isVisible(), 'Cancel control is not visible');

  console.log('PASS section example importer: scoped file/draft/image extraction, bounded private derivation, preview, explicit Apply/Cancel, and no raw example persistence');
} finally {
  await browser.close();
}
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
