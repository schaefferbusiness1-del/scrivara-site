'use strict';

/* Account A's in-flight template or open Settings edits must never land in
 * account B. This drives the real browser module with two namespaced stores,
 * key-only switches, async switches, and the shell's session-boundary epoch. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const laneFiles = ['feat_mls_draft_tuning.js', '1p-feat_mls_draft_tuning.js', 'cloned-feat_mls_draft_tuning.js'];
const laneSources = laneFiles.map(name => fs.readFileSync(path.join(root, name), 'utf8'));
assert.strictEqual(laneSources[1], laneSources[0], '1p draft tuning drifted from the account-bound owner');
assert.strictEqual(laneSources[2], laneSources[0], 'cloned draft tuning drifted from the account-bound owner');
for (const token of ['mls:session-boundary', 'storageScope()', 'scopeCurrent(originScope)', 'writeForScope(working, workingScope)']) {
  assert.ok(laneSources[0].includes(token), 'missing account-boundary contract: ' + token);
}

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const shell = `<!doctype html><html><body>
      <div id="settingsModal" class="show"><div class="modal"><button onclick="saveSettings()">Save settings</button></div></div>
    </body></html>`;
    await page.route('https://mls-draft-account-boundary.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: shell }));
    await page.goto('https://mls-draft-account-boundary.test/settings');
    await page.evaluate(() => {
      window.__testAccount = 'account-A';
      window.__mlsSessionEpoch = 1;
      window.uns = key => window.__testAccount + '::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
    });
    await page.addScriptTag({ path: path.join(root, 'feat_mls_draft_tuning.js') });

    const result = await page.evaluate(async () => {
      const api = window.__mlsDraftTuning;
      const key = account => account + '::draftTuningV1';
      const setAccount = account => { window.__testAccount = account; };
      const snapshot = () => ({
        a: localStorage.getItem(key('account-A')),
        b: localStorage.getItem(key('account-B'))
      });

      // Give both namespaces distinct durable baselines.
      setAccount('account-A');
      api.write(api.defaults());
      api.profileEditor('hpi').update('standard', { label: 'A baseline', templateText: 'A BASELINE TEMPLATE' });
      setAccount('account-B');
      api.write(api.defaults());
      api.profileEditor('hpi').update('standard', { label: 'B baseline', templateText: 'B BASELINE TEMPLATE' });
      const baseline = snapshot();

      // Exact reported defect: A preview, B apply. Neither namespace changes.
      setAccount('account-A');
      const importer = api.exampleImporter('hpi', 'standard');
      importer.preview({ name: 'A imported', templateText: 'A PRIVATE IMPORT', instructions: 'A PRIVATE COMMENT' });
      setAccount('account-B');
      const crossApply = importer.apply();
      const afterCrossApply = snapshot();

      // A switch before derive refuses before network use.
      setAccount('account-A');
      let fetchCount = 0;
      window.fetch = async () => { fetchCount += 1; return { ok: true, json: async () => ({ templateText: 'SHOULD NOT RETURN' }) }; };
      const beforeDerive = api.exampleImporter('hpi', 'standard');
      setAccount('account-B');
      let beforeDeriveCode = '';
      try { await beforeDerive.derive({ text: 'synthetic outline' }); } catch (error) { beforeDeriveCode = error && error.code || ''; }
      const afterBeforeDerive = snapshot();

      // A switch while the request is awaiting is caught after fetch and
      // before the response can become a preview or touch either store.
      setAccount('account-A');
      const duringDerive = api.exampleImporter('hpi', 'standard');
      window.fetch = async () => {
        fetchCount += 1;
        setAccount('account-B');
        return { ok: true, json: async () => ({ templateText: 'ASYNC A PRIVATE IMPORT', instructions: 'PRIVATE' }) };
      };
      let duringDeriveCode = '';
      try { await duringDerive.derive({ text: 'synthetic outline' }); } catch (error) { duringDeriveCode = error && error.code || ''; }
      const afterDuringDerive = snapshot();

      // Same namespace after a real session epoch still refuses (ABA guard).
      setAccount('account-A');
      const epochImporter = api.exampleImporter('hpi', 'standard');
      epochImporter.preview({ templateText: 'OLD SESSION TEMPLATE', instructions: 'OLD SESSION COMMENT' });
      window.__mlsSessionEpoch = 2;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 2, nextAccount: 'account-A' } }));
      const epochApply = epochImporter.apply();
      const afterEpochApply = snapshot();

      // Open Settings under A, edit, then change only uns() to B. Save must
      // fail without writing A or B.
      window.__mlsSessionEpoch = 3;
      setAccount('account-A');
      api.beginSettings();
      document.getElementById('mlsDtFamily').value = 'hpi';
      document.getElementById('mlsDtFamily').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('mlsDtSectionTemplateText').value = 'A UNSAVED SETTINGS TEMPLATE';
      const beforeSettingsSwitch = snapshot();
      setAccount('account-B');
      const settingsSave = api.saveFromUi();
      const afterSettingsSwitch = snapshot();

      // Reopen under A, then fire the canonical session boundary. Returning
      // to A cannot revive the old editor session.
      setAccount('account-A');
      api.beginSettings();
      document.getElementById('mlsDtFamily').value = 'hpi';
      document.getElementById('mlsDtFamily').dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('mlsDtSectionTemplateText').value = 'OLD EPOCH SETTINGS TEMPLATE';
      const beforeSettingsEpoch = snapshot();
      window.__mlsSessionEpoch = 4;
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 4, nextAccount: 'account-A' } }));
      const epochSettingsSave = api.saveFromUi();
      const afterSettingsEpoch = snapshot();

      return {
        baseline, crossApply, afterCrossApply,
        fetchCount, beforeDeriveCode, afterBeforeDerive,
        duringDeriveCode, afterDuringDerive,
        epochApply, afterEpochApply,
        beforeSettingsSwitch, settingsSave, afterSettingsSwitch,
        beforeSettingsEpoch, epochSettingsSave, afterSettingsEpoch
      };
    });

    assert.strictEqual(result.crossApply, false, 'A importer applied after switching to B');
    assert.deepStrictEqual(result.afterCrossApply, result.baseline, 'cross-account Apply changed A or B');
    assert.strictEqual(result.beforeDeriveCode, 'draft-tuning-account-changed', 'pre-derive switch did not fail with the closed account code');
    assert.strictEqual(result.fetchCount, 1, 'pre-derive switch used network or async-switch derive did not reach its one controlled request');
    assert.deepStrictEqual(result.afterBeforeDerive, result.baseline, 'pre-derive refusal changed A or B');
    assert.strictEqual(result.duringDeriveCode, 'draft-tuning-account-changed', 'mid-derive switch escaped the post-await account check');
    assert.deepStrictEqual(result.afterDuringDerive, result.baseline, 'mid-derive refusal changed A or B');
    assert.strictEqual(result.epochApply, false, 'old-session importer revived after session boundary');
    assert.deepStrictEqual(result.afterEpochApply, result.baseline, 'epoch-refused Apply changed A or B');
    assert.strictEqual(result.settingsSave, null, 'A Settings session saved into B');
    assert.deepStrictEqual(result.afterSettingsSwitch, result.beforeSettingsSwitch, 'key-switched Settings save changed A or B');
    assert.strictEqual(result.epochSettingsSave, null, 'old-epoch Settings session saved after boundary');
    assert.deepStrictEqual(result.afterSettingsEpoch, result.beforeSettingsEpoch, 'epoch-refused Settings save changed A or B');

    console.log('PASS draft-tuning account boundary: importer and open Settings bind namespace+epoch; pre/mid-async, key-switch, and ABA saves fail closed without changing either account');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
