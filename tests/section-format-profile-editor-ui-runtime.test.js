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
    await page.route('https://mls-ui-runtime.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
    await page.goto('https://mls-ui-runtime.test/settings');
    await page.evaluate(() => {
      window.uns = key => 'ui-runtime-account::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '..', 'feat_mls_draft_tuning.js') });

    await page.selectOption('#mlsDtFamily', 'hpi');
    assert.equal(await page.locator('#mlsDtSectionNameHost').evaluate(el => el.style.display), '', 'HPI format-name control is hidden');
    assert.equal(await page.locator('#mlsDtSectionTemplateTextHost').evaluate(el => el.style.display), '', 'HPI template editor is hidden');

    const before = await page.locator('#mlsDtSectionProfile option').count();
    await page.click('#mlsDtSectionAdd');
    assert.equal(await page.locator('#mlsDtSectionProfile option').count(), before + 1, 'Add format did not add a profile');
    const customId = await page.inputValue('#mlsDtSectionProfile');
    assert.match(customId, /^custom_/, 'new format did not become the selected profile');

    await page.fill('#mlsDtSectionName', 'Procedure follow-up HPI');
    await page.fill('#mlsDtSectionWhen', 'procedure response is discussed today');
    await page.fill('#mlsDtSectionTemplateText', 'Reason for follow-up:\nInterval response:\nFunctional change:\nRelevant symptoms:');
    await page.fill('#mlsDtInstructions', 'Lead with the procedure response and preserve documented timing, laterality, and functional change.');

    // Exercise the real selector change handler twice. The newly entered HPI
    // values must remain attached to their original profile instead of being
    // copied over the next profile during the change event.
    await page.selectOption('#mlsDtSectionProfile', 'standard');
    await page.fill('#mlsDtSectionTemplateText', 'STANDARD HPI OUTLINE');
    await page.selectOption('#mlsDtSectionProfile', customId);
    assert.equal(await page.inputValue('#mlsDtSectionName'), 'Procedure follow-up HPI', 'profile switch lost the format name');
    assert.match(await page.inputValue('#mlsDtSectionTemplateText'), /Interval response:/, 'profile switch lost or overwrote the template');
    assert.match(await page.inputValue('#mlsDtInstructions'), /procedure response/, 'profile switch lost AI prompt comments');

    // Switching draft families must isolate the five independent editors.
    await page.selectOption('#mlsDtFamily', 'ros');
    assert.doesNotMatch(await page.inputValue('#mlsDtSectionTemplateText'), /Interval response:/, 'HPI template leaked into ROS');
    await page.selectOption('#mlsDtFamily', 'hpi');
    await page.selectOption('#mlsDtSectionProfile', customId);
    assert.match(await page.inputValue('#mlsDtSectionTemplateText'), /Interval response:/, 'HPI template did not survive a family round trip');

    const saveReturn = await page.evaluate(() => window.__mlsDraftTuning.saveFromUi());
    const savedResult = await page.evaluate(id => {
      const family = window.__mlsDraftTuning.read().families.hpi;
      return { saved: family.profiles.find(profile => profile.id === id) || null, ids: family.profiles.map(profile => profile.id) };
    }, customId);
    const saved = savedResult.saved;
    assert.ok(saved, 'saved profile disappeared: wanted ' + customId + ', found ' + savedResult.ids.join(', ') + '; save returned ' + JSON.stringify(saveReturn && saveReturn.families && saveReturn.families.hpi));
    assert.equal(saved.label, 'Procedure follow-up HPI');
    assert.match(saved.templateText, /Functional change:/);
    assert.match(saved.when, /procedure response/);
    assert.match(saved.instructions, /timing, laterality/);

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
