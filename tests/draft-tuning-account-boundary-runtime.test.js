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
      document.getElementById('mlsDtFamily').value = 'opnote';
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
      document.getElementById('mlsDtFamily').value = 'opnote';
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

    await testDedicatedCloud(browser);
    console.log('PASS draft-tuning account boundary and dedicated cloud: scoped awaits, large-library isolation, exact multi-profile restore, CAS conflict choices, 413 suppression and legacy capability fallback');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });

async function testDedicatedCloud(browser) {
  const backendPrepare = process.env.MLS_DRAFT_TUNING_BACKEND_MODULE
    ? (await import(require('url').pathToFileURL(process.env.MLS_DRAFT_TUNING_BACKEND_MODULE).href)).prepareAccountDraftTuning : null;
  const app = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
  const prefsCode = app.slice(app.indexOf('const PREF_SYNC_KEYS='), app.indexOf('\n/* b940 -> qol-2.0:', app.indexOf('const PREF_SYNC_KEYS=')));
  assert(prefsCode.includes('async function loadPrefsFromServer'), 'real preference transport slice missing');
  const account = { draftTuning: null, revision: 0, source: 'none' };
  let mode = '', getGate = null, releaseGet, putCount = 0, legacyPosts = [], legacyGet = {}, lostPut = false;
  const cloud = await browser.newPage();
  const cloudRoute = async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/api/prefs/draft-tuning') {
      if (req.method() === 'GET') {
        if (getGate) await getGate;
        if (mode === 'network') return route.abort('failed');
        if (mode === 'invalid') return route.fulfill({ json: {} });
        if (['404', '405', '500', '401'].includes(mode)) return route.fulfill({ status: Number(mode), body: '{}' });
        return route.fulfill({ json: { ok: true, ...account, updated_at: null } });
      }
      putCount++;
      const body = req.postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['baseRevision', 'draftTuning']);
      if (backendPrepare) body.draftTuning = backendPrepare(body.draftTuning).value;
      if (mode === '413') return route.fulfill({ status: 413, json: { ok: false, code: 'DRAFT_TUNING_TOO_LARGE', limitBytes: 3145728, actualBytes: 3145729 } });
      if (mode === 'race') { account.revision++; account.draftTuning.families.hpi.profiles[0].label = 'New account edit'; mode = ''; }
      const equal = JSON.stringify(body.draftTuning) === JSON.stringify(account.draftTuning);
      if (!equal && body.baseRevision !== account.revision) return route.fulfill({ status: 409, json: { ok: false, code: 'DRAFT_TUNING_CONFLICT', revision: account.revision } });
      if (!equal) { account.draftTuning = body.draftTuning; account.revision++; account.source = 'segment'; }
      if (lostPut) { lostPut = false; return route.abort('failed'); }
      return route.fulfill({ json: { ok: true, ...account, replayed: equal, migrated: false } });
    }
    if (url.pathname === '/api/prefs') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON(); legacyPosts.push(body);
        if (JSON.stringify(body.prefs).length > 500000) return route.fulfill({ status: 413, json: { error: 'prefs too large' } });
        if (account.source === 'segment' && body.prefs.draftTuningV1 && JSON.stringify(JSON.parse(body.prefs.draftTuningV1)) !== JSON.stringify(account.draftTuning)) return route.fulfill({ status: 409, json: { code: 'DRAFT_TUNING_CONFLICT' } });
        legacyGet = body.prefs; return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { prefs: legacyGet } });
    }
    return route.fulfill({ contentType: 'text/html', body: '<div id="settingsModal" class="show"><div class="modal"><button onclick="saveSettings()">Save settings</button></div></div>' });
  };
  await cloud.route('https://mls-dedicated-cloud.test/**', cloudRoute);
  await cloud.goto('https://mls-dedicated-cloud.test/');
  await cloud.evaluate(() => {
    window.__account = 'A'; window.__token = 'token-A'; window.__mlsSessionEpoch = 1; window.__startup = 1;
    window.uns = key => window.__account + '::' + key; window.bkToken = () => window.__token;
    window.bkBase = () => ''; window.backendMode = () => true;
    window.sfStartupValid = opts => !opts.cancelled && !(opts.signal && opts.signal.aborted) && (!opts.startupId || opts.startupId === window.__startup);
    window.getGenLength = () => 'standard'; window.getGenInstr = () => ''; window.saveSettings = () => {};
    window.toast = () => {}; window.STUDIO_CLOUD_BUDGET = 250000;
    window._studioMergeFromCloud = () => false;
  });
  await cloud.addScriptTag({ path: path.join(root, '1p-feat_mls_draft_tuning.js') });
  await cloud.evaluate(() => { window.__mlsEnsureDraftTuning = async () => window.__mlsDraftTuning; });
  await cloud.addScriptTag({ content: prefsCode });
  const seeded = await cloud.evaluate(() => {
    const api = window.__mlsDraftTuning;
    for (const family of api.visitTemplateSections) {
      const editor = api.profileEditor(family), first = editor.list();
      editor.add({ id: 'third_' + family, label: 'Third ' + family, templateText: 'THIRD ' + family,
        when: family === 'plan' ? 'diabetes follow-up' : '', whenAuto: family === 'plan' ? 1 : 0 });
      editor.update(first[1].id, { templateText: 'SECOND ' + family }); editor.select(first[1].id);
    }
    const templates = JSON.stringify([{ id: 'large-operative-template', text: 'x'.repeat(520000) }]);
    localStorage.setItem(uns('templates'), templates);
    return { tuning: api.read(), templates };
  });
  legacyGet = { templates: seeded.templates }; // pre-existing operative account copy must survive failed omnibus replacement
  assert.equal(await cloud.evaluate(() => syncPrefsToServer()), false, 'oversized omnibus unexpectedly succeeded');
  const browserAccount = await cloud.evaluate(value => window.__mlsDraftTuning.sanitize(value), account.draftTuning);
  for (const family of ['soap', 'hpi', 'ros', 'exam', 'assessment', 'plan']) {
    assert.deepEqual(browserAccount.families[family].profiles, seeded.tuning.families[family].profiles,
      family + ': ' + JSON.stringify({ actual: browserAccount.families[family].profiles, expected: seeded.tuning.families[family].profiles }));
    assert.equal(browserAccount.families[family].activeProfile, seeded.tuning.families[family].activeProfile);
  }
  assert.equal(putCount, 1);
  assert.equal(Object.hasOwn(legacyPosts.at(-1).prefs, 'draftTuningV1'), false);
  assert.match(await cloud.textContent('#mlsDtCloudStatus'), /saved in your account/i, 'omnibus failure downgraded dedicated success');
  assert.equal(await cloud.evaluate(() => localStorage.getItem(uns('templates'))), seeded.templates);
  const blank = await browser.newPage();
  await blank.route('https://mls-dedicated-cloud.test/**', cloudRoute);
  await blank.goto('https://mls-dedicated-cloud.test/');
  await blank.evaluate(() => {
    window.__mlsSessionEpoch = 1;
    window.uns = key => 'A::' + key; window.bkToken = () => 'token-A'; window.bkBase = () => ''; window.backendMode = () => true;
    window.sfStartupValid = opts => !(opts.signal && opts.signal.aborted) && (!opts.startupId || opts.startupId === 1);
    window.getGenLength = () => 'standard'; window.getGenInstr = () => ''; window.saveSettings = () => {};
    window.toast = () => {}; window.STUDIO_CLOUD_BUDGET = 250000; window._studioMergeFromCloud = () => false;
  });
  assert.equal(await blank.evaluate(() => localStorage.length), 0, 'blank-device fixture already contains preferences');
  await blank.addScriptTag({ path: path.join(root, '1p-feat_mls_draft_tuning.js') });
  await blank.evaluate(() => { window.__mlsEnsureDraftTuning = async () => window.__mlsDraftTuning; });
  await blank.addScriptTag({ content: prefsCode });
  assert.equal(await blank.evaluate(() => loadPrefsFromServer({ startupId: 1 })), true);
  assert.deepEqual(await blank.evaluate(() => window.__mlsDraftTuning.read()), seeded.tuning, 'a truly blank browser lost profile arrays or active selections');
  assert.equal(await blank.evaluate(() => localStorage.getItem(uns('templates'))), seeded.templates, 'operative cloud bytes changed during independent tuning restore');
  for (const family of ['soap', 'hpi', 'ros', 'exam', 'assessment', 'plan'])
    assert.equal(await blank.inputValue('#mlsVnTplProfile_' + family), seeded.tuning.families[family].activeProfile);
  await blank.close();
  await cloud.evaluate(() => { localStorage.removeItem(uns('draftTuningV1')); localStorage.removeItem(uns('draftTuningV1') + '::cloud-baseline'); });
  assert.equal(await cloud.evaluate(() => loadPrefsFromServer({ startupId: 1 })), true);
  assert.deepEqual(await cloud.evaluate(() => window.__mlsDraftTuning.read()), seeded.tuning, 'blank-device restore changed profiles or active ids');
  assert.equal(await cloud.evaluate(() => localStorage.getItem(uns('templates'))), seeded.templates);
  const meta = await cloud.evaluate(() => JSON.parse(localStorage.getItem(uns('draftTuningV1') + '::cloud-baseline')));
  assert.equal(meta.revision, 1); assert.match(meta.sha256, /^[a-f0-9]{64}$/);

  // A lost 200 must adopt an equal remote copy without another write.
  await cloud.evaluate(() => { const e = window.__mlsDraftTuning.profileEditor('hpi'); e.update(e.list()[0].id, { label: 'Lost response edit' }); });
  lostPut = true;
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).ok, false);
  const afterLost = putCount;
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).ok, true);
  assert.equal(putCount, afterLost, 'lost-200 recovery repeated a committed write');

  // Simultaneous changes never union arrays or infer an active/deleted profile.
  account.draftTuning.families.plan.profiles.pop(); account.revision++;
  await cloud.evaluate(() => { const e = window.__mlsDraftTuning.profileEditor('plan'); e.update(e.list()[0].id, { label: 'Device plan edit' }); });
  const preservedLocal = await cloud.evaluate(() => localStorage.getItem(uns('draftTuningV1')));
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).conflict, true);
  assert.equal(await cloud.locator('#mlsDtCloudKeep').isVisible(), true);
  await cloud.evaluate(() => { document.getElementById('mlsVisitNoteTemplatesSection').remove(); window.__mlsDraftTuning.mountVisitTemplates(); });
  assert.equal(await cloud.locator('#mlsDtCloudUse').isVisible(), true, 'remount lost conflict resolution');
  assert.equal(await cloud.evaluate(() => localStorage.getItem(uns('draftTuningV1'))), preservedLocal);
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.resolveCloud('remote'))).ok, true);
  assert.equal(await cloud.locator('#mlsVnTplProfile_plan option').count(), account.draftTuning.families.plan.profiles.length);
  await cloud.evaluate(() => { const e = window.__mlsDraftTuning.profileEditor('hpi'); e.update(e.list()[0].id, { label: 'Keep device edit' }); });
  mode = 'race';
  const postsBeforeRace = legacyPosts.length;
  assert.equal(await cloud.evaluate(() => syncPrefsToServer()), false);
  assert.equal(legacyPosts.length, postsBeforeRace, '409 dual-wrote omnibus preferences');
  assert.equal(await cloud.locator('#mlsDtCloudKeep').isVisible(), true);
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.resolveCloud('local'))).ok, true);
  assert.equal(account.draftTuning.families.hpi.profiles[0].label, 'Keep device edit');

  mode = '413';
  await cloud.evaluate(() => { const e = window.__mlsDraftTuning.profileEditor('hpi'); e.update(e.list()[0].id, { label: 'Too large edit' }); });
  const before413 = JSON.stringify(account);
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).tooLarge, true);
  const put413 = putCount;
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).tooLarge, true);
  assert.equal(putCount, put413, 'unchanged rejected content retried'); assert.equal(JSON.stringify(account), before413);
  const postsBefore413 = legacyPosts.length;
  assert.equal(await cloud.evaluate(() => syncPrefsToServer()), false);
  assert.equal(putCount, put413); assert.equal(legacyPosts.length, postsBefore413, '413 dual-wrote omnibus preferences');
  assert.match(await cloud.textContent('#mlsDtCloudStatus'), /Saved on this device.*account copy is unchanged/);
  mode = '';
  await cloud.evaluate(() => { const e = window.__mlsDraftTuning.profileEditor('hpi'); e.update(e.list()[0].id, { label: 'Smaller edit' }); });
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).ok, true);

  // Every await must remain attached to account, startup and abort ownership.
  for (const change of ['account', 'aba', 'abort', 'startup']) {
    getGate = new Promise(resolve => { releaseGet = resolve; });
    await cloud.evaluate(() => {
      window.__account = 'A'; window.__token = 'token-A'; window.__startup = 1;
      window.__controller = new AbortController();
      window.__beforeAwait = JSON.stringify(Object.entries(localStorage).sort());
      window.__pending = loadPrefsFromServer({ startupId: 1, signal: window.__controller.signal });
    });
    await cloud.waitForTimeout(25);
    await cloud.evaluate(change => {
      if (change === 'abort') window.__controller.abort();
      else if (change === 'startup') window.__startup++;
      else { window.__account = 'B'; window.__token = 'token-B'; window.__mlsSessionEpoch++; window.dispatchEvent(new Event('mls:session-boundary')); if (change === 'aba') { window.__account = 'A'; window.__token = 'token-A'; window.__mlsSessionEpoch++; window.dispatchEvent(new Event('mls:session-boundary')); } }
    }, change);
    releaseGet(); getGate = null;
    assert.equal(await cloud.evaluate(() => window.__pending), false, change + ' completed a stale load');
    assert.equal(await cloud.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()) === window.__beforeAwait), true, change + ' altered local data');
  }
  await cloud.evaluate(() => { window.__account = 'A'; window.__token = 'token-A'; window.__startup = 1; });
  for (const status of ['500', '401', 'network', 'invalid', '404', '405']) {
    mode = status;
    const postsBefore = legacyPosts.length;
    await cloud.evaluate(() => syncPrefsToServer());
    if (!['404', '405'].includes(status)) assert.equal(legacyPosts.length, postsBefore, 'failed dedicated read erased legacy-only data via omnibus');
    else assert.equal(Object.hasOwn(legacyPosts.at(-1).prefs, 'draftTuningV1'), true, status + ' capability fallback mismatch');
  }
  mode = '';
  for (const phase of ['json', 'hash', 'loader']) {
    await cloud.evaluate(({ phase, remote }) => {
      window.__beforeAwait = JSON.stringify(Object.entries(localStorage).sort());
      window.__originalFetch = window.fetch; window.__originalDigest = crypto.subtle.digest;
      window.__originalLoader = window.__mlsEnsureDraftTuning;
      if (phase === 'json') window.fetch = async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { window.__releaseAwait = () => resolve(remote); }) });
      if (phase === 'hash') crypto.subtle.digest = function (...args) {
        return new Promise(resolve => { window.__originalDigest.apply(this, args).then(value => { window.__releaseAwait = () => resolve(value); }); });
      };
      if (phase === 'loader') window.__mlsEnsureDraftTuning = () => new Promise(resolve => { window.__releaseAwait = () => resolve(window.__mlsDraftTuning); });
      window.__pending = loadPrefsFromServer({ startupId: 1 });
    }, { phase, remote: { ok: true, ...account } });
    await cloud.waitForFunction(() => typeof window.__releaseAwait === 'function');
    await cloud.evaluate(() => {
      window.__account = 'B'; window.__mlsSessionEpoch++; window.dispatchEvent(new Event('mls:session-boundary'));
      window.__account = 'A'; window.__mlsSessionEpoch++; window.dispatchEvent(new Event('mls:session-boundary'));
      window.__releaseAwait();
    });
    assert.equal(await cloud.evaluate(() => window.__pending), false, phase + ' crossed an ABA boundary');
    assert.equal(await cloud.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()) === window.__beforeAwait), true);
    await cloud.evaluate(() => { window.fetch = window.__originalFetch; crypto.subtle.digest = window.__originalDigest; window.__mlsEnsureDraftTuning = window.__originalLoader; delete window.__releaseAwait; });
  }
  mode = '';
  account.draftTuning = null; account.revision = 0; account.source = 'none';
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).conflict, true, 'missing account copy silently cleared local formats');
  await cloud.evaluate(() => {
    document.getElementById('settingsModal').classList.remove('show');
    document.getElementById('mlsVisitNoteTemplatesSection').remove();
    window.__mlsDraftTuning.mountVisitTemplates();
    document.getElementById('settingsModal').classList.add('show');
  });
  assert.equal(await cloud.locator('#mlsDtCloudUse').isVisible(), true);
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.resolveCloud('remote'))).ok, true);
  assert.equal(await cloud.evaluate(() => localStorage.getItem(uns('draftTuningV1'))), null);
  assert.equal(await cloud.evaluate(() => JSON.parse(localStorage.getItem(uns('draftTuningV1') + '::cloud-baseline')).revision), 0);
  assert.deepEqual(await cloud.evaluate(() => window.__mlsDraftTuning.read()), await cloud.evaluate(() => window.__mlsDraftTuning.defaults()));
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudLoad())).ok, true, 'explicit null-account choice returned to conflict');
  assert.equal(await cloud.evaluate(() => localStorage.getItem(uns('templates'))), seeded.templates);

  account.draftTuning = seeded.tuning; account.revision = 0; account.source = 'legacy';
  await cloud.evaluate(() => {
    const state = window.__mlsDraftTuning.defaults(); state.families.hpi.profiles[0].label = 'Unbased device edit';
    window.__mlsDraftTuning.write(state);
    localStorage.removeItem(uns('draftTuningV1') + '::cloud-baseline');
  });
  const beforeUnbased = putCount;
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.cloudSync())).conflict, true, 'unbased device overwrote account data');
  assert.equal(putCount, beforeUnbased);
  assert.equal((await cloud.evaluate(() => window.__mlsDraftTuning.resolveCloud('remote'))).ok, true);
  assert.equal(account.source, 'segment'); assert.equal(account.revision, 1, 'legacy copy was omitted before migration');
  const beforeOldClient = JSON.stringify(account);
  assert.equal(await cloud.evaluate(() => fetch('/api/prefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs: { draftTuningV1: JSON.stringify(window.__mlsDraftTuning.defaults()) } }) }).then(response => response.status)), 409);
  assert.equal(JSON.stringify(account), beforeOldClient, 'old-client conflict changed dedicated account formats');
  console.log('DEDICATED_CLOUD_PROOF ' + JSON.stringify({ operativeTemplateChars: seeded.templates.length, visitFamilies: 6, profilesPerFamily: 3, nonFirstActive: true, actualBackendCanonicalizer: !!backendPrepare }));
  await cloud.close();
}
