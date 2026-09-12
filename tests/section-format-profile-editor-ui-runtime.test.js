'use strict';

const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const shell = `<!doctype html><html><body>
      <div id="settingsModal" class="show"><div class="modal">
        <div class="row"><button type="button" onclick="saveSettings()">Save settings</button></div>
      </div></div>
    </body></html>`;
    await page.route('https://mls-ui-runtime.test/**', route => {
      if (new URL(route.request().url()).pathname === '/api/section-templates/derive') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          name: 'Imported supporting draft',
          templateText: 'Imported question:\nImported response:\nImported next step:',
          instructions: 'Keep the imported chronology.'
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: shell });
    });
    await page.goto('https://mls-ui-runtime.test/settings');
    await page.evaluate(() => {
      window.uns = key => 'ui-runtime-account::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
      window.bkBase = () => '';
      window.bkToken = () => 'test-token';
      window.__openedProcedureTemplates = 0;
      window.openTemplates = () => { window.__openedProcedureTemplates += 1; };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '..', 'feat_mls_draft_tuning.js') });

    await page.selectOption('#mlsDtFamily', 'general_draft');
    assert.equal(await page.locator('#mlsDtAdvanced').getAttribute('open'), null, 'advanced settings should start collapsed');
    assert.equal(await page.locator('#mlsDtSectionTemplate').isVisible(), true, 'template-following mode is hidden from the primary template editor');
    assert.equal(await page.locator('#mlsDtSectionTemplateHost').evaluate(el => !!el.closest('#mlsDtAdvanced')), false, 'template-following mode is still nested under Advanced');
    assert.match(await page.locator('#mlsDtSectionTemplate option[value=adapt]').textContent(), /Follow template \(recommended\)/i, 'recommended template-following mode is unclear');
    assert.match(await page.textContent('#mlsDtEffectiveSummary'), /format|template/i, 'effective format summary is missing');
    assert.equal(await page.isDisabled('#mlsDtSectionTemplate'), true, 'template fidelity is active with no template');
    for (const id of ['#mlsDtSectionName', '#mlsDtSectionWhen', '#mlsDtSectionImportNamePreview']) {
      assert.equal(await page.locator(id).getAttribute('type'), 'text', id + ' is not an explicit text input');
    }
    const shortBox = await page.locator('#mlsDtSectionName').evaluate(el => {
      const style = getComputedStyle(el);
      return { height: parseFloat(style.height), minHeight: parseFloat(style.minHeight), width: style.width };
    });
    assert.ok(shortBox.height <= 42.5 && shortBox.minHeight <= 0.5,
      'short format field inherited a tall note-box size: ' + JSON.stringify(shortBox));
    assert.notEqual(shortBox.width, '0px', 'short format field has no usable scoped width');
    assert.equal(await page.locator('#mlsDtSectionNameHost').evaluate(el => el.style.display), '', 'saved-format name control is hidden');
    assert.equal(await page.locator('#mlsDtSectionTemplateTextHost').evaluate(el => el.style.display), '', 'saved-format template editor is hidden');

    // Creating beside a shipped Guide profile must still start in Adapt. Guide
    // is a loose behavior, not a safe inherited default for a blank upload.
    await page.selectOption('#mlsDtSectionProfile', 'summary');
    assert.equal(await page.inputValue('#mlsDtSectionTemplate'), 'guide', 'Guide fixture profile is not active');
    const before = await page.locator('#mlsDtSectionProfile option').count();
    await page.click('#mlsDtSectionAdd');
    assert.equal(await page.locator('#mlsDtSectionProfile option').count(), before + 1, 'Add format did not add a profile');
    const customId = await page.inputValue('#mlsDtSectionProfile');
    assert.match(customId, /^custom_/, 'new format did not become the selected profile');
    assert.equal(await page.inputValue('#mlsDtSectionTemplate'), 'adapt', 'new blank format inherited loose Guide mode');

    await page.fill('#mlsDtSectionName', 'Procedure follow-up draft');
    await page.locator('#mlsDtAdvanced').evaluate(el => { el.open = true; });
    await page.fill('#mlsDtSectionWhen', 'procedure response is discussed today');
    await page.fill('#mlsDtSectionTemplateText', 'Reason for follow-up:\nInterval response:\nFunctional change:\nRelevant symptoms:');
    await page.fill('#mlsDtInstructions', 'Lead with the procedure response and preserve documented timing, laterality, and functional change.');
    assert.equal(await page.isDisabled('#mlsDtSectionTemplate'), false, 'template fidelity stayed disabled after adding a template');
    assert.match(await page.textContent('#mlsDtEffectiveSummary'), /character template.*keeps template headings and structure/i, 'effective summary does not identify the active template and fidelity behavior');

    // An imported preview belongs to the currently selected output/profile.
    // Applying it preserves existing comments and appends distinct derived
    // guidance instead of silently replacing the doctor's saved instruction.
    await page.click('#mlsDtSectionImportOpen');
    await page.fill('#mlsDtSectionImportExample', 'A synthetic supporting-draft example with chronology and functional change.');
    await page.click('#mlsDtSectionImportDerive');
    await page.waitForFunction(() => document.getElementById('mlsDtSectionImportPreview').style.display !== 'none');
    await page.click('#mlsDtSectionImportApply');
    assert.match(await page.inputValue('#mlsDtSectionTemplateText'), /Imported response:/, 'imported template did not apply to the selected profile');
    assert.match(await page.inputValue('#mlsDtInstructions'), /procedure response.*imported chronology/i, 'import replaced rather than appended existing comments');
    assert.match(await page.textContent('#mlsDtAppliedStatus'), /Other clinical drafts.*Imported supporting draft.*Save Settings/i, 'applied preview status does not name its output and profile');

    // If appending would exceed the bound, Apply refuses without truncating or
    // replacing either value and explains what the clinician must fix.
    const priorTemplate = await page.inputValue('#mlsDtSectionTemplateText');
    const longComments = 'x'.repeat(590);
    await page.fill('#mlsDtInstructions', longComments);
    await page.click('#mlsDtSectionImportOpen');
    await page.fill('#mlsDtSectionImportExample', 'Another synthetic supporting-draft example.');
    await page.click('#mlsDtSectionImportDerive');
    await page.waitForFunction(() => document.getElementById('mlsDtSectionImportPreview').style.display !== 'none');
    await page.fill('#mlsDtSectionImportTemplatePreview', 'SHOULD NOT APPLY');
    await page.click('#mlsDtSectionImportApply');
    assert.equal(await page.inputValue('#mlsDtInstructions'), longComments, 'over-limit import changed existing comments');
    assert.equal(await page.inputValue('#mlsDtSectionTemplateText'), priorTemplate, 'over-limit import partially applied its template');
    assert.match(await page.textContent('#mlsDtSectionImportStatus'), /exceed 600 characters.*did not replace or cut off/i, 'over-limit import lacks an explicit refusal');
    await page.fill('#mlsDtInstructions', 'Lead with the procedure response and preserve documented timing, laterality, and functional change. | Keep the imported chronology.');

    // Exercise the real selector change handler twice. The newly entered
    // values must remain attached to their original profile instead of being
    // copied over the next profile during the change event.
    await page.selectOption('#mlsDtSectionProfile', 'standard');
    await page.fill('#mlsDtSectionTemplateText', 'STANDARD SUPPORTING DRAFT OUTLINE');
    await page.selectOption('#mlsDtSectionProfile', customId);
    assert.equal(await page.inputValue('#mlsDtSectionName'), 'Imported supporting draft', 'profile switch lost the format name');
    assert.match(await page.inputValue('#mlsDtSectionTemplateText'), /Imported response:/, 'profile switch lost or overwrote the template');
    assert.match(await page.inputValue('#mlsDtInstructions'), /procedure response/, 'profile switch lost AI prompt comments');

    // Switching draft families must isolate the five independent editors.
    await page.selectOption('#mlsDtFamily', 'avs');
    assert.doesNotMatch(await page.inputValue('#mlsDtSectionTemplateText'), /Interval response:/, 'procedure template leaked into general draft');
    await page.selectOption('#mlsDtFamily', 'general_draft');
    await page.selectOption('#mlsDtSectionProfile', customId);
    assert.match(await page.inputValue('#mlsDtSectionTemplateText'), /Imported response:/, 'saved format did not survive a family round trip');

    // A first import into an untouched Guide profile defaults to Adapt and says
    // plainly what that means. An explicit Guide choice is preserved, as is
    // Guide when replacing a template that already exists.
    await page.selectOption('#mlsDtFamily', 'avs');
    await page.selectOption('#mlsDtSectionProfile', 'education');
    assert.equal(await page.inputValue('#mlsDtSectionTemplate'), 'guide', 'blank Guide fixture is missing');
    assert.equal(await page.inputValue('#mlsDtSectionTemplateText'), '', 'blank Guide fixture unexpectedly has a template');
    await page.click('#mlsDtSectionImportOpen');
    await page.fill('#mlsDtSectionImportExample', 'Synthetic follow-up Plan example.');
    await page.click('#mlsDtSectionImportDerive');
    await page.waitForFunction(() => document.getElementById('mlsDtSectionImportPreview').style.display !== 'none');
    await page.click('#mlsDtSectionImportApply');
    assert.equal(await page.inputValue('#mlsDtSectionTemplate'), 'adapt', 'first import into blank inherited Guide instead of defaulting to Adapt');
    assert.match(await page.textContent('#mlsDtAppliedStatus'), /Keeps template headings and structure/i, 'first-import status hides the effective fidelity behavior');

    await page.click('#mlsDtSectionAdd');
    const explicitGuideId = await page.inputValue('#mlsDtSectionProfile');
    await page.fill('#mlsDtSectionTemplateText', 'Temporary outline to choose fidelity.');
    await page.selectOption('#mlsDtSectionTemplate', 'guide');
    await page.fill('#mlsDtSectionTemplateText', '');
    await page.click('#mlsDtSectionImportOpen');
    await page.fill('#mlsDtSectionImportExample', 'Synthetic explicitly guided Plan example.');
    await page.click('#mlsDtSectionImportDerive');
    await page.waitForFunction(() => document.getElementById('mlsDtSectionImportPreview').style.display !== 'none');
    await page.click('#mlsDtSectionImportApply');
    assert.equal(await page.inputValue('#mlsDtSectionTemplate'), 'guide', 'explicit Guide choice was overwritten on first import');
    const guideOption = await page.locator('#mlsDtSectionTemplate option[value="guide"]').textContent();
    const followOption = await page.locator('#mlsDtSectionTemplate option[value="adapt"]').textContent();
    assert.match(guideOption, /Guide only.*headings and layout may change/i, 'Guide option can be mistaken for format-preserving behavior');
    assert.match(followOption, /Follow template \(recommended\).*keep its structure/i, 'uploaded-template recommendation is unclear');
    assert.match(await page.textContent('#mlsDtTemplateModeHelp'), /ideas only.*does not preserve.*headings, order, or layout/i, 'Guide helper hides that template presentation can change');
    assert.match(await page.textContent('#mlsDtEffectiveSummary'), /ideas only.*does not preserve.*headings, order, or layout/i, 'collapsed summary hides Guide presentation behavior');

    await page.click('#mlsDtSectionImportOpen');
    await page.fill('#mlsDtSectionImportExample', 'Synthetic replacement for an existing guided Plan template.');
    await page.click('#mlsDtSectionImportDerive');
    await page.waitForFunction(() => document.getElementById('mlsDtSectionImportPreview').style.display !== 'none');
    await page.click('#mlsDtSectionImportApply');
    assert.equal(await page.inputValue('#mlsDtSectionProfile'), explicitGuideId, 'replacement import changed the target profile');
    assert.equal(await page.inputValue('#mlsDtSectionTemplate'), 'guide', 'replacing a nonempty Guide template reset its saved mode');

    await page.selectOption('#mlsDtFamily', 'opnote');
    assert.equal(await page.locator('#mlsDtProcedureTemplatesLink').evaluate(el => el.style.display), '', 'Op Note does not expose the separate procedure template library');
    assert.match(await page.textContent('#mlsDtEffectiveSummary'), /operative note style only.*Upload and edit operative templates in Templates/i, 'Op Note summary conflates Settings style and operative templates');
    assert.equal(await page.locator('#mlsDtSectionImportOpen').isVisible(), false, 'operative import is still available from the wrong surface');
    await page.click('#mlsDtProcedureTemplatesLink');
    assert.equal(await page.evaluate(() => window.__openedProcedureTemplates), 1, 'procedure template library link did not use the existing opener');
    await page.selectOption('#mlsDtFamily', 'general_draft');
    await page.selectOption('#mlsDtSectionProfile', customId);

    const saveReturn = await page.evaluate(() => window.__mlsDraftTuning.saveFromUi());
    const savedResult = await page.evaluate(id => {
      const family = window.__mlsDraftTuning.read().families.general_draft;
      return { saved: family.profiles.find(profile => profile.id === id) || null, ids: family.profiles.map(profile => profile.id) };
    }, customId);
    const saved = savedResult.saved;
    assert.ok(saved, 'saved profile disappeared: wanted ' + customId + ', found ' + savedResult.ids.join(', ') + '; save returned ' + JSON.stringify(saveReturn && saveReturn.families && saveReturn.families.general_draft));
    assert.equal(saved.label, 'Imported supporting draft');
    assert.match(saved.templateText, /Imported next step:/);
    assert.match(saved.when, /procedure response/);
    assert.match(saved.instructions, /timing, laterality.*imported chronology/i);

    // Drive the actual Remove button down to one profile. The last format is a
    // required safety/default anchor and the UI must make further deletion
    // impossible rather than silently creating an empty editor.
    while (await page.locator('#mlsDtSectionProfile option').count() > 1) await page.click('#mlsDtSectionDelete');
    assert.equal(await page.locator('#mlsDtSectionProfile option').count(), 1, 'Remove did not delete the selected reusable format');
    assert.equal(await page.isDisabled('#mlsDtSectionDelete'), true, 'UI allowed the final format to be removed');
    assert.match(await page.textContent('#mlsDtSectionProfileStatus'), /final format cannot be removed/i);

    console.log('PASS section format editor UI runtime: real add/edit/switch/isolation/save/remove controls work');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
