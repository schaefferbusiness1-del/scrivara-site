'use strict';

/* VISIT NOTE TEMPLATES - THE PLAIN SCREEN, DRIVEN FOR REAL.
 *
 * The owner asked what happened to a template upload / new UI for the VISIT
 * note templates and said, in the same breath, not to confuse them with the
 * op-note templates: "they are totally different."
 *
 * So this suite proves the two things that make that true:
 *
 *   1. THE NEW SCREEN WRITES THE EXISTING CONTRACT. A paste plus a mode plus
 *      Save must land in prefs.draftTuningV1.families.<section> - the same
 *      store the backend reader (src/draftTuning.js) derives required inner
 *      labels from - and must be visible in the module's own resolved
 *      generation tuning. A screen that stores its own private copy would look
 *      identical on screen and change no note.
 *   2. IT NEVER TOUCHES THE OP-NOTE LIBRARY. The four op-note keys are
 *      snapshotted before the first press and compared byte-for-byte after a
 *      save AND after a remove.
 *
 * The uploader is proved through the SHELL'S OWN per-file dispatcher
 * (_tplReadAnyFile), lifted out of 1pScribeFlow.html rather than retyped, so a
 * .txt takes the real plain-text branch and a real .docx fixture takes the real
 * Word branch through the pinned local mammoth build. If the screen ever grows
 * a second parser of its own, the spy count here stops matching.
 *
 * Module lane: this drives 1p-feat_mls_draft_tuning.js, the canonical source
 * the /1p lane edits. feat_mls_draft_tuning.js and cloned-feat_mls_draft_tuning.js
 * are derived from it, and tests/draft-tuning-account-boundary-runtime.test.js
 * is the suite that pins all three lanes byte-identical.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(root, '1p-feat_mls_draft_tuning.js');
const SHELL_PATH = path.join(root, '1pScribeFlow.html');
const TWIN_PATH = path.join(root, '1p', 'index.html');
const MAMMOTH_PATH = path.join(root, 'vendor', 'mammoth.browser-1.12.0.min.js');
const DOCX_FIXTURE = path.join(root, 'tests', 'fixtures', 'vendor-boundary-single-paragraph.docx');

const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');
const shellSource = fs.readFileSync(SHELL_PATH, 'utf8');
const twinSource = fs.readFileSync(TWIN_PATH, 'utf8');

const PLAN_TEMPLATE = [
  'DIAGNOSIS:',
  '- one line for each problem addressed today',
  'RECOMMENDATIONS:',
  '- medication, therapy, imaging, referral',
  'DISCUSSION:',
  '- what was explained and what was agreed'
].join('\n');

/* ---------- static contract: one parser, one op-note library ---------- */

/* the new screen's own code, with its comments stripped - a comment that names
   the op-note keys in order to say it leaves them alone is not a reach into them */
const vntFrom = moduleSource.indexOf('var VISIT_TEMPLATE_PROFILE_ID');
const vntTo = moduleSource.indexOf('function boot() {');
assert.ok(vntFrom > 0 && vntTo > vntFrom, 'could not locate the visit-note template block in the module');
const vntCode = moduleSource.slice(vntFrom, vntTo).replace(/\/\*[\s\S]*?\*\//g, ' ');

assert.ok(vntCode.includes('window._tplReadAnyFile'),
  'the visit-note template uploader must call the shell\'s existing per-file reader, not a second parser');
assert.ok(!/_ensureMammoth|extractRawText|mammoth/i.test(vntCode),
  'Word-reader wiring was duplicated into the visit-note screen - the shell already owns exactly one of it');
for (const opKey of ['opNoteTemplateMode', 'templateActive', 'useTemplates', 'templates\'']) {
  assert.ok(!vntCode.includes("'" + opKey), 'the visit-note screen reaches into the op-note key ' + opKey);
}
assert.ok(!/\bopnote\b/.test(vntCode), 'the visit-note screen reaches into the operative-note draft settings');
/* the ONE settings surface a doctor is sent to, from both doors */
assert.ok(shellSource.includes('id="genVisitTemplatesLink"') && shellSource.includes('onclick="openVisitNoteTemplates()"'),
  'the visit room lost its one-line route to the visit note templates');
assert.ok(twinSource.includes('id="genVisitTemplatesLink"') && twinSource.includes('onclick="openVisitNoteTemplates()"'),
  '1p/index.html drifted from 1pScribeFlow.html on the visit-room template link');
assert.ok(/async function openVisitNoteTemplates\(\)\{/.test(shellSource) && /async function openVisitNoteTemplates\(\)\{/.test(twinSource),
  'openVisitNoteTemplates() is missing from a shell - the visit-room link would be a no-op');

/* The shell's dispatcher really does route .docx at mammoth and .pdf at the
   PDF text layer. The screen delegates to it, so proving the delegation plus
   this routing is what chains the file types together. */
assert.ok(/_tplReadAnyFile[\s\S]{0,1200}_extractDocxText/.test(shellSource),
  'the shared per-file reader stopped routing .docx through the Word extractor');
assert.ok(/_tplReadAnyFile[\s\S]{0,1200}extractPdfText/.test(shellSource),
  'the shared per-file reader stopped routing .pdf through the PDF text extractor');

/* ---------- lift the real reader out of the shell, do not retype it ---------- */

function lift(startMarker, endMarker, what) {
  const from = shellSource.indexOf(startMarker);
  assert.ok(from > 0, 'could not find ' + what + ' in 1pScribeFlow.html');
  const to = shellSource.indexOf(endMarker, from);
  assert.ok(to > from, 'could not find the end of ' + what + ' in 1pScribeFlow.html');
  const text = shellSource.slice(from, to).replace(/\s+$/, '');
  assert.ok(text.endsWith('}'), what + ' did not lift cleanly');
  return text;
}
const READER_SOURCE = [
  lift('function _tplLetters(t){', '\n/* The SAME 40-letter bar', '_tplLetters'),
  lift('function _tplReadDone(reason,text){', '\nasync function _tplReadAnyFile', '_tplReadDone'),
  lift('async function _tplReadAnyFile(file){', '\n/* Count how many SEPARATE notes', '_tplReadAnyFile'),
  lift('function _cleanExtractedText(t, lower){', '\n/* Lazy-load the pinned local Mammoth', '_cleanExtractedText'),
  lift('async function _extractDocxText(file){', '\nfunction saveTemplateFromForm(){', '_extractDocxText')
].join('\n');

/* ---------- plain-English rule: no developer words on this screen ---------- */

const JARGON = /\bprofiles?\b|\bschemas?\b|\bJSON\b|\bprefs?\b|activeProfile|templateMode|sectionMode|draftTuningV1|\bAPI\b|localStorage|\bfamil(?:y|ies)\b|\bparameters?\b|\bconfig\w*\b|\bnull\b|\bundefined\b|\bboolean\b|\bstring\b|\barray\b|\bobject\b|\benum\b|\bnamespace\b/i;

const SHELL_HTML = `<!doctype html><html><body>
  <div id="settingsModal" class="show"><div class="modal">
    <div class="set-section">
      <p class="set-head">Note defaults</p>
      <input type="hidden" id="noteFormatSel" value="soap">
    </div>
    <div class="row"><button onclick="saveSettings()">Save settings</button></div>
  </div></div>
</body></html>`;

(async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-vntpl-'));
  const txtPath = path.join(tmpDir, 'my-plan-outline.txt');
  fs.writeFileSync(txtPath, PLAN_TEMPLATE + '\n', 'utf8');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://mls-visit-note-templates.test/**', route => {
      if (new URL(route.request().url()).pathname === '/api/section-templates/derive') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          name: 'Derived plan format',
          templateText: 'PLAN:\nAction:\nFollow-up:',
          instructions: 'Use documented timing only.'
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: SHELL_HTML });
    });
    await page.goto('https://mls-visit-note-templates.test/settings');

    await page.evaluate(() => {
      window.__testAccount = 'account-vntpl';
      window.__mlsSessionEpoch = 1;
      window.uns = key => window.__testAccount + '::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
      window.__toasts = [];
      window.toast = (message, tone) => { window.__toasts.push([String(message), String(tone || '')]); };
      window.__prefSyncCalls = 0;
      window.syncPrefsToServer = () => { window.__prefSyncCalls++; };
      window.__mlsPrivateExampleExtractor = async input => ({ text: String(input && input.text || '') });
      /* the op-note library, already populated, exactly as a real account has it */
      localStorage.setItem(window.uns('templates'), JSON.stringify([
        { id: 'tpl1', name: 'Right knee arthroscopy', keywords: ['knee'], text: 'PREOPERATIVE DIAGNOSIS:\nPROCEDURE:\nFINDINGS:' }
      ]));
      localStorage.setItem(window.uns('useTemplates'), '1');
      localStorage.setItem(window.uns('templateActive'), 'tpl1');
      localStorage.setItem(window.uns('opNoteTemplateMode'), 'strict');
    });

    /* the real Word reader, and the shell's real per-file dispatcher */
    await page.addScriptTag({ path: MAMMOTH_PATH });
    await page.addScriptTag({
      content: 'var _tplReadReason="";\n' +
        'function _ensureMammoth(){ return Promise.resolve(window.mammoth); }\n' +
        'function extractPdfText(){ return Promise.resolve(""); }\n' +
        'function _extractLegacyDocText(){ return Promise.resolve(""); }\n' +
        'function _tplStripWordJunk(t){ return String(t||""); }\n' +
        'function backendMode(){ return false; }\n' +
        'function bkToken(){ return ""; }\n' +
        'function bkBase(){ return ""; }\n' +
        'function readFileAsDataUrl(){ return Promise.resolve(""); }\n' +
        READER_SOURCE + '\n' +
        'var __tplReadReal = _tplReadAnyFile;\n' +
        'window.__readerCalls = [];\n' +
        'window._tplReadAnyFile = function (file) { window.__readerCalls.push(String(file && file.name || "")); return __tplReadReal(file); };\n'
    });

    await page.addScriptTag({ path: MODULE_PATH });

    const opBaseline = await page.evaluate(() => ({
      templates: localStorage.getItem(window.uns('templates')),
      useTemplates: localStorage.getItem(window.uns('useTemplates')),
      templateActive: localStorage.getItem(window.uns('templateActive')),
      opNoteTemplateMode: localStorage.getItem(window.uns('opNoteTemplateMode'))
    }));

    /* ---- the screen exists, is the FIRST card, and says the right sentence ---- */
    const mounted = await page.evaluate(() => {
      // Opening/reconciling Settings repeatedly must retain one editor for each job.
      for (let n = 0; n < 4; n++) {
        window.__mlsDraftTuning.beginSettings();
        window.__mlsDraftTuning.mountVisitTemplates();
      }
      const modal = document.querySelector('#settingsModal .modal');
      const sections = Array.prototype.slice.call(modal.querySelectorAll(':scope > .set-section'));
      const sec = document.getElementById('mlsVisitNoteTemplatesSection');
      return {
        exists: !!sec,
        visitOwners: modal.querySelectorAll('#mlsVisitNoteTemplatesSection').length,
        otherOwners: modal.querySelectorAll('#mlsDraftTuningSection').length,
        otherFamilies: Array.from(modal.querySelectorAll('#mlsDtFamily option'), option => option.value),
        visitInputs: modal.querySelectorAll('#mlsVnTplFile').length,
        first: !!sec && sections[0] === sec,
        head: (sec.querySelector('.set-head') || {}).textContent || '',
        desc: (sec.querySelector('.set-desc') || {}).textContent || '',
        rows: Array.prototype.slice.call(sec.querySelectorAll('[id^="mlsVnTplRow_"]')).map(el => el.id),
        previews: ['hpi', 'ros', 'exam', 'assessment', 'plan']
          .map(fam => (document.getElementById('mlsVnTplPreview_' + fam) || {}).textContent || '')
      };
    });
    assert.ok(mounted.exists, 'the Visit note templates screen never mounted');
    assert.strictEqual(mounted.visitOwners, 1, 'reopening Settings duplicated the canonical visit editor');
    assert.strictEqual(mounted.otherOwners, 1, 'reopening Settings duplicated the other-output editor');
    assert.strictEqual(mounted.visitInputs, 1, 'visit sections acquired competing file-reader inputs');
    assert.deepStrictEqual(mounted.otherFamilies.filter(family => ['soap', 'hpi', 'ros', 'exam', 'assessment', 'plan'].includes(family)), [],
      'the lower output picker reintroduced a second editor for visit templates');
    assert.ok(mounted.otherFamilies.includes('opnote') && mounted.otherFamilies.includes('avs'),
      'consolidation removed the non-visit outputs');
    assert.ok(mounted.first, 'the Visit note templates screen is not the first card in Settings > Notes & AI');
    assert.ok(/Visit note templates/.test(mounted.head), 'the screen lost its name: ' + JSON.stringify(mounted.head));
    assert.ok(mounted.desc.includes('These shape your visit notes: Whole visit / SOAP, HPI, ROS, Exam, Assessment, Plan.') &&
      mounted.desc.includes('Operative note templates are separate'),
      'the header sentence that keeps visit and operative templates apart is gone: ' + JSON.stringify(mounted.desc));
    assert.deepStrictEqual(mounted.rows,
      ['mlsVnTplRow_soap', 'mlsVnTplRow_hpi', 'mlsVnTplRow_ros', 'mlsVnTplRow_exam', 'mlsVnTplRow_assessment', 'mlsVnTplRow_plan'],
      'the whole-visit plus five visit-note sections are not all on the screen, in order');
    await page.fill('#mlsDtSectionName', 'UNSAVED non-visit edit');
    const initialPlanProfiles = await page.locator('#mlsVnTplProfile_plan option').count();
    await page.click('#mlsVnTplAdd_plan');
    assert.equal(await page.locator('#mlsVnTplProfile_plan option').count(), initialPlanProfiles + 1, 'canonical visit editor Add did not create a profile');
    const addedPlanId = await page.locator('#mlsVnTplProfile_plan option:last-child').getAttribute('value');
    assert.equal(await page.inputValue('#mlsVnTplProfile_plan'), addedPlanId, 'Add did not select the new canonical profile');
    assert.equal(await page.inputValue('#mlsDtSectionName'), 'UNSAVED non-visit edit', 'visit Add discarded an unrelated unsaved Settings edit');
    await page.locator('#mlsVnTplEditor_plan details').nth(0).locator('summary').click();
    await page.fill('#mlsVnTplName_plan', 'Configured blank plan');
    await page.fill('#mlsVnTplWhen_plan', 'when follow-up is discussed');
    await page.fill('#mlsVnTplComments_plan', 'Keep only documented timing.');
    await page.click('#mlsVnTplSave_plan');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.profiles.some(row => row.label === 'Configured blank plan'));
    await page.click('#mlsVnTplOpen_plan');
    await page.locator('#mlsVnTplEditor_plan details').nth(1).locator('summary').click();
    await page.fill('#mlsVnTplExample_plan', 'PATIENT NAME: Jane Doe\nPLAN: continue documented therapy.');
    await page.click('#mlsVnTplExampleDerive_plan');
    await page.waitForFunction(() => document.getElementById('mlsVnTplExampleApply_plan').disabled === false);
    await page.fill('#mlsVnTplExampleName_plan', 'Derived plan format');
    await page.fill('#mlsVnTplExampleTemplate_plan', 'PLAN:\nAction:\nFollow-up: EDITED');
    await page.fill('#mlsVnTplExampleComments_plan', 'Use documented timing only. EDITED');
    await page.click('#mlsVnTplExampleApply_plan');
    assert.match(await page.inputValue('#mlsVnTplText_plan'), /EDITED/, 'editable derived preview did not populate the canonical editor');
    await page.fill('#mlsVnTplWhen_plan', 'manual routing stays intact');
    await page.click('#mlsVnTplSave_plan');
    const derivedSaved = await page.evaluate(() => JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.profiles.find(row => row.label === 'Derived plan format'));
    assert.equal(derivedSaved.when, 'manual routing stays intact', 'manual routing was lost during derived Apply/Save');
    const boundary = await page.evaluate(async () => {
      const importer = window.__mlsDraftTuning.exampleImporter('plan', 'my_template');
      window.__testAccount = 'account-switched-during-preview';
      const result = importer.apply({ name: 'Should not land', templateText: 'SHOULD NOT LAND', instructions: '' });
      return { result, stored: localStorage.getItem(window.uns('draftTuningV1')) || '' };
    });
    assert.equal(boundary.result, false, 'canonical example preview crossed an account boundary');
    assert.doesNotMatch(boundary.stored, /SHOULD NOT LAND/, 'cross-account canonical preview mutated storage');
    await page.evaluate(() => { window.__testAccount = 'account-vntpl'; });
    for (const preview of mounted.previews) {
      assert.strictEqual(preview, 'No template - MLS writes this section from what was said.',
        'a section with no template must say so in plain words, not show an empty line');
    }

    /* ---- (c) THE UPLOADER: a .txt through the shell's own reader ---- */
    await page.click('#mlsVnTplOpen_plan');
    assert.strictEqual(await page.isVisible('#mlsVnTplEditor_plan'), true, 'the inline editor did not open');
    const [txtChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#mlsVnTplUpload_plan')
    ]);
    await txtChooser.setFiles(txtPath);
    await page.waitForFunction(() => /DIAGNOSIS:/.test(document.getElementById('mlsVnTplText_plan').value), null, { timeout: 8000 });
    const afterTxt = await page.evaluate(() => ({
      text: document.getElementById('mlsVnTplText_plan').value,
      named: document.getElementById('mlsVnTplFileName_plan').textContent,
      readerCalls: window.__readerCalls.slice()
    }));
    assert.ok(afterTxt.text.includes('RECOMMENDATIONS:') && afterTxt.text.includes('DISCUSSION:'),
      'the uploaded plain-text template did not reach the editor: ' + JSON.stringify(afterTxt.text));
    assert.strictEqual(afterTxt.named, 'my-plan-outline.txt', 'the screen did not name the file it read');
    assert.deepStrictEqual(afterTxt.readerCalls, ['my-plan-outline.txt'],
      'the uploader did not go through the shell\'s existing per-file reader');

    /* ---- (c) THE UPLOADER: a real .docx through the pinned Word reader ---- */
    const [docxChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('#mlsVnTplUpload_plan')
    ]);
    await docxChooser.setFiles(DOCX_FIXTURE);
    await page.waitForFunction(() =>
      document.getElementById('mlsVnTplFileName_plan').textContent === 'vendor-boundary-single-paragraph.docx',
      null, { timeout: 15000 });
    const afterDocx = await page.evaluate(() => ({
      text: document.getElementById('mlsVnTplText_plan').value,
      readerCalls: window.__readerCalls.slice()
    }));
    assert.ok(afterDocx.text.trim().length > 0 && !/DIAGNOSIS:/.test(afterDocx.text),
      'the .docx did not replace the editor text with what the Word reader returned: ' + JSON.stringify(afterDocx.text));
    assert.deepStrictEqual(afterDocx.readerCalls, ['my-plan-outline.txt', 'vendor-boundary-single-paragraph.docx'],
      'the .docx took a different path than the .txt - there must be exactly one reader');

    /* ---- paste the synthetic Plan template, choose Adapt, Save ---- */
    await page.fill('#mlsVnTplText_plan', PLAN_TEMPLATE);
    await page.check('#mlsVnTplMode_plan_adapt');
    await page.click('#mlsVnTplSave_plan');
    await page.waitForFunction(profileId => {
      try {
        const raw = localStorage.getItem(window.uns('draftTuningV1'));
        return !!raw && JSON.parse(raw).families.plan.activeProfile === profileId;
      } catch (e) { return false; }
    }, addedPlanId, { timeout: 8000 });

    /* ---- (a) the EXISTING contract carries it ---- */
    const stored = await page.evaluate(profileId => {
      const plan = JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan;
      const mine = plan.profiles.filter(row => row.id === profileId)[0] || null;
      return { activeProfile: plan.activeProfile, familyTemplateMode: plan.templateMode, mine: mine, count: plan.profiles.length };
    }, addedPlanId);
    assert.strictEqual(stored.activeProfile, addedPlanId, 'Save did not keep the selected saved format active');
    assert.ok(stored.mine, 'the saved template has no home in the stored contract');
    assert.strictEqual(stored.mine.label, 'Derived plan format', 'the saved template lost its edited plain name');
    assert.strictEqual(stored.mine.templateMode, 'adapt', 'the chosen follow-mode did not land on the saved template');
    assert.strictEqual(stored.familyTemplateMode, 'adapt',
      'the section-level follow-mode did not mirror the saved template - the server reads this one');
    for (const label of ['DIAGNOSIS:', 'RECOMMENDATIONS:', 'DISCUSSION:']) {
      assert.ok(stored.mine.templateText.includes(label),
        'the saved template lost the inner label ' + label + ' the server derives its required headings from');
    }

    /* ---- (b) the module's own resolved generation tuning carries it ---- */
    const resolved = await page.evaluate(() => {
      const tuning = window.__mlsDraftTuning.forStructured({});
      return {
        templateText: tuning.families.plan.templateText,
        templateMode: tuning.families.plan.templateMode,
        activeProfile: tuning.families.plan.activeProfile,
        hpiTemplate: tuning.families.hpi.templateText
      };
    });
    assert.strictEqual(resolved.activeProfile, addedPlanId, 'the generation tuning did not pick up the selected saved format');
    assert.strictEqual(resolved.templateMode, 'adapt', 'the generation tuning lost the follow-mode');
    for (const label of ['DIAGNOSIS:', 'RECOMMENDATIONS:', 'DISCUSSION:']) {
      assert.ok(resolved.templateText.includes(label),
        'the generation tuning did not carry ' + label + ' - the note would not follow the template');
    }
    assert.strictEqual(resolved.hpiTemplate, '', 'saving the Plan template leaked into another section');

    const syncCalls = await page.evaluate(() => window.__prefSyncCalls);
    assert.ok(syncCalls >= 1, 'the save never asked the account sync to carry it to the server');

    /* ---- the row now shows the template, in two lines, in plain words ---- */
    const painted = await page.evaluate(() => ({
      preview: document.getElementById('mlsVnTplPreview_plan').textContent,
      now: document.getElementById('mlsVnTplNow_plan').textContent
    }));
    assert.strictEqual(painted.preview, 'DIAGNOSIS:\n- one line for each problem addressed today',
      'the row preview is not the first two lines of the saved template: ' + JSON.stringify(painted.preview));
    assert.strictEqual(painted.now, 'Now set to: Follow it, skip what was not said',
      'the row does not say, in plain words, how closely MLS is following it: ' + JSON.stringify(painted.now));

    /* ---- (d) the op-note library is byte-identical ---- */
    const opAfterSave = await page.evaluate(() => ({
      templates: localStorage.getItem(window.uns('templates')),
      useTemplates: localStorage.getItem(window.uns('useTemplates')),
      templateActive: localStorage.getItem(window.uns('templateActive')),
      opNoteTemplateMode: localStorage.getItem(window.uns('opNoteTemplateMode'))
    }));
    assert.deepStrictEqual(opAfterSave, opBaseline,
      'saving a VISIT note template changed the OPERATIVE note template library - they are totally different and must stay that way');

    /* ---- (f) the jargon rule, measured on what a doctor actually reads ---- */
    const visible = await page.evaluate(() =>
      document.getElementById('mlsVisitNoteTemplatesSection').textContent.replace(/\s+/g, ' ').trim());
    const jargonHit = visible.match(JARGON);
    assert.strictEqual(jargonHit, null,
      'a developer word reached the screen a doctor reads: ' + JSON.stringify(jargonHit && jargonHit[0]) +
      ' in ' + JSON.stringify(visible.slice(0, 400)));
    for (const plain of ['Follow it exactly', 'Follow it, skip what was not said', 'Just a guide',
      'Paste or upload a template', 'Upload a file']) {
      assert.ok(visible.includes(plain), 'the screen lost the plain control "' + plain + '"');
    }

    /* ---- metadata-only Save, Clear, and Delete are distinct actions ---- */
    await page.click('#mlsVnTplOpen_plan');
    await page.fill('#mlsVnTplName_plan', 'Blank configured plan');
    await page.fill('#mlsVnTplWhen_plan', 'when follow-up is discussed');
    await page.fill('#mlsVnTplComments_plan', 'Keep only documented timing.');
    await page.click('#mlsVnTplSave_plan');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.profiles.some(row => row.label === 'Blank configured plan'));
    await page.click('#mlsVnTplOpen_plan');
    await page.click('#mlsVnTplClear_plan');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.profiles.some(row => row.label === 'Blank configured plan' && row.templateText === ''));
    /* ---- (e) Delete restores what MLS shipped ---- */
    await page.click('#mlsVnTplOpen_plan');
    await page.click('#mlsVnTplDelete_plan');
    await page.waitForFunction(profileId => {
      try {
        const plan = JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan;
        return plan.activeProfile !== profileId && !plan.profiles.some(row => row.id === profileId);
      } catch (e) { return false; }
    }, addedPlanId, { timeout: 8000 });
    const afterRemove = await page.evaluate(profileId => {
      const plan = JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan;
      const tuning = window.__mlsDraftTuning.forStructured({});
      return {
        activeProfile: plan.activeProfile,
        stillMine: plan.profiles.some(row => row.id === profileId),
        ids: plan.profiles.map(row => row.id),
        tuningText: tuning.families.plan.templateText,
        preview: document.getElementById('mlsVnTplPreview_plan').textContent,
        now: document.getElementById('mlsVnTplNow_plan').textContent
      };
    }, addedPlanId);
    assert.strictEqual(afterRemove.activeProfile, 'routine',
      'Remove did not put the shipped Plan format back in charge: ' + JSON.stringify(afterRemove));
    assert.strictEqual(afterRemove.stillMine, false, 'Remove left the removed template behind');
    assert.deepStrictEqual(afterRemove.ids, ['routine', 'escalation'], 'Remove changed the shipped Plan formats');
    assert.strictEqual(afterRemove.tuningText, '', 'the generation tuning still carries a removed template');
    assert.strictEqual(afterRemove.preview, 'No template - MLS writes this section from what was said.',
      'the row does not say, in plain words, that the section has no template again');
    assert.strictEqual(afterRemove.now, '', 'a removed template left its follow-mode line on screen');

    /* Choosing a saved format is itself the clinician's activation action.
       It must update the generation owner without forcing them to reopen the
       format editor and press Save when no fields changed. */
    await page.selectOption('#mlsVnTplProfile_plan', 'escalation');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.activeProfile === 'escalation');
    const selectedOnly = await page.evaluate(() => ({
      stored: JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.activeProfile,
      resolved: window.__mlsDraftTuning.forStructured({}).families.plan.activeProfile
    }));
    assert.deepStrictEqual(selectedOnly, { stored: 'escalation', resolved: 'escalation' },
      'choosing an existing saved format changed only the visible dropdown, not the next generated note');
    await page.evaluate(() => {
      const old = document.getElementById('mlsVisitNoteTemplatesSection');
      if (old) old.remove();
      window.__mlsDraftTuning.beginSettings();
    });
    assert.strictEqual(await page.inputValue('#mlsVnTplProfile_plan'), 'escalation',
      'a fresh Settings mount ignored the persisted saved format and displayed the first format instead');
    await page.selectOption('#mlsVnTplProfile_plan', 'routine');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.plan.activeProfile === 'routine');

    const opAfterRemove = await page.evaluate(() => ({
      templates: localStorage.getItem(window.uns('templates')),
      useTemplates: localStorage.getItem(window.uns('useTemplates')),
      templateActive: localStorage.getItem(window.uns('templateActive')),
      opNoteTemplateMode: localStorage.getItem(window.uns('opNoteTemplateMode'))
    }));
    assert.deepStrictEqual(opAfterRemove, opBaseline,
      'removing a VISIT note template changed the OPERATIVE note template library');

    /* ---- the other door: Settings "Save settings" must not undo the write ----
       profileEditor persists immediately, while the AI-output-formats panel
       saves a snapshot taken when Settings opened. Without a re-snapshot the
       next press of Save settings silently reverts the doctor's template. */
    const hpiProfileId = await page.inputValue('#mlsVnTplProfile_hpi');
    await page.click('#mlsVnTplOpen_hpi');
    await page.fill('#mlsVnTplText_hpi', 'ONSET:\nWHAT MAKES IT WORSE:');
    await page.check('#mlsVnTplMode_hpi_strict');
    await page.click('#mlsVnTplSave_hpi');
    await page.waitForFunction(profileId => {
      try { return JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.hpi.activeProfile === profileId; }
      catch (e) { return false; }
    }, hpiProfileId, { timeout: 8000 });
    await page.evaluate(() => { window.__mlsDraftTuning.saveFromUi(); });
    const afterSettingsSave = await page.evaluate(profileId => {
      const hpi = JSON.parse(localStorage.getItem(window.uns('draftTuningV1'))).families.hpi;
      const mine = hpi.profiles.filter(row => row.id === profileId)[0] || null;
      return { activeProfile: hpi.activeProfile, text: mine && mine.templateText, mode: hpi.templateMode };
    }, hpiProfileId);
    assert.strictEqual(afterSettingsSave.activeProfile, hpiProfileId,
      'pressing Save settings reverted the template saved on the simple screen');
    assert.ok(String(afterSettingsSave.text || '').includes('ONSET:'),
      'pressing Save settings threw away the template text saved on the simple screen');
    assert.strictEqual(afterSettingsSave.mode, 'strict',
      'pressing Save settings threw away the follow-mode saved on the simple screen');

    /* The lower screen has one explicit operative-template route. Old Settings
       outlines remain inspectable but cannot be overwritten by its controls. */
    const legacy = await page.evaluate(() => {
      const api = window.__mlsDraftTuning, editor = api.profileEditor('opnote');
      const row = editor.list()[0];
      editor.update(row.id, { templateText: 'LEGACY OPERATIVE OUTLINE: preserve this text' });
      editor.select(row.id);
      api.beginSettings();
      window.__templateOpens = 0;
      window.openTemplates = () => { window.__templateOpens++; };
      return { id: row.id, text: editor.list().find(item => item.id === row.id).templateText };
    });
    assert.equal(await page.locator('#mlsDraftTuningSection .set-head').textContent(), 'Other document formats');
    assert.equal(await page.locator('#mlsDtSectionTemplateText').getAttribute('readonly'), '');
    assert.equal(await page.locator('#mlsDtSectionImportOpen').isVisible(), false);
    assert.equal(await page.locator('#mlsDtSectionDelete').isDisabled(), true);
    assert.equal(await page.locator('#mlsDtReset').isDisabled(), true);
    await page.click('#mlsDtProcedureTemplatesLink');
    assert.equal(await page.evaluate(() => window.__templateOpens), 1);
    await page.evaluate(() => {
      document.getElementById('mlsDtSectionTemplateText').value = 'WRONG SURFACE OVERWRITE';
      document.getElementById('mlsDtSectionDelete').dispatchEvent(new Event('click'));
      document.getElementById('mlsDtReset').dispatchEvent(new Event('click'));
      window.__mlsDraftTuning.saveFromUi();
    });
    assert.equal(await page.evaluate(id => window.__mlsDraftTuning.profiles('opnote').find(row => row.id === id).templateText, legacy.id), legacy.text);

    /* A stale visit option must route to the first screen, never create a
       second editor via familyId's SOAP fallback. */
    for (const family of ['soap', 'hpi', 'plan', '']) {
      await page.evaluate(family => {
        const select = document.getElementById('mlsDtFamily');
        const option = document.createElement('option'); option.value = family; select.appendChild(option);
        select.value = family; select.dispatchEvent(new Event('change', { bubbles: true })); option.remove();
      }, family);
      assert.equal(await page.inputValue('#mlsDtFamily'), 'opnote');
      assert.equal(await page.locator('#mlsVisitNoteTemplatesSection:visible').count(), 1);
    }

    const beforeReload = await page.evaluate(() => localStorage.getItem(window.uns('draftTuningV1')));
    await page.reload();
    await page.evaluate(() => {
      window.uns = key => 'account-vntpl::' + key;
      window.getGenLength = () => 'standard'; window.getGenInstr = () => '';
      window.saveSettings = () => {};
    });
    await page.addScriptTag({ path: MODULE_PATH });
    for (let n = 0; n < 3; n++) {
      await page.evaluate(() => {
        document.getElementById('mlsVisitNoteTemplatesSection').remove();
        window.__mlsDraftTuning.mountVisitTemplates();
        window.__mlsDraftTuning.beginSettings();
      });
      assert.equal(await page.locator('#mlsVisitNoteTemplatesSection:visible').count(), 1);
      assert.equal(await page.locator('#mlsVnTplFile').count(), 1);
      const available = await page.evaluate(() => window.__mlsDraftTuning.visitTemplateSections.map(family => ({
        family,
        stored: window.__mlsDraftTuning.profiles(family).map(row => row.id),
        shown: Array.from(document.querySelectorAll('#mlsVnTplProfile_' + family + ' option'), option => option.value)
      })));
      for (const row of available) {
        assert(row.shown.length >= 2, row.family + ' lost multiple saved formats');
        assert.deepEqual(row.shown, row.stored, row.family + ' has inaccessible saved templates');
      }
      assert.equal(await page.evaluate(() => localStorage.getItem(window.uns('draftTuningV1'))), beforeReload,
        'reload or remount changed stored template data');
    }
    /* Slow file reads cannot cross profile, section, account or mount boundaries. */
    for (const scenario of ['profile', 'family', 'account', 'aba', 'remount', 'replace', 'superseded', 'reopen']) {
      await page.evaluate(() => {
        window.__mlsSessionEpoch = 1;
        window.__testAccount = 'account-vntpl';
        window.uns = key => window.__testAccount + '::' + key;
        window.__mlsDraftTuning.beginSettings();
        document.getElementById('mlsVnTplOpen_plan').click();
        window._tplReadAnyFile = () => new Promise(resolve => { window.__finishFile = resolve; });
        const file = document.getElementById('mlsVnTplFile'); file.click = () => {};
        document.getElementById('mlsVnTplUpload_plan').click();
        const transfer = new DataTransfer(); transfer.items.add(new File(['OLD'], 'slow.txt', { type: 'text/plain' }));
        file.files = transfer.files; file.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(() => typeof window.__finishFile === 'function');
      await page.evaluate(scenario => {
        if (scenario === 'profile') {
          const select = document.getElementById('mlsVnTplProfile_plan');
          select.value = Array.from(select.options).find(option => option.value !== select.value).value;
          select.dispatchEvent(new Event('change'));
        } else if (scenario === 'family') document.getElementById('mlsVnTplOpen_hpi').click();
        else if (scenario === 'account' || scenario === 'aba') {
          window.__testAccount = 'other-account'; window.__mlsSessionEpoch++;
          window.dispatchEvent(new Event('mls:session-boundary'));
          if (scenario === 'aba') { window.__testAccount = 'account-vntpl'; window.__mlsSessionEpoch++; window.dispatchEvent(new Event('mls:session-boundary')); }
        } else if (scenario === 'remount') {
          document.getElementById('mlsVisitNoteTemplatesSection').remove(); window.__mlsDraftTuning.mountVisitTemplates();
        } else if (scenario === 'replace') {
          const target = document.getElementById('mlsVnTplText_plan'); target.replaceWith(target.cloneNode(true));
        } else if (scenario === 'reopen') window.__mlsDraftTuning.beginSettings();
        else document.getElementById('mlsVnTplUpload_plan').click();
        document.getElementById('mlsVnTplText_plan').value = 'CURRENT EDITOR CONTENT';
        window.__storeBeforeCompletion = JSON.stringify(Object.entries(localStorage).sort());
        window.__finishFile('STALE FILE CONTENT');
      }, scenario);
      await page.waitForTimeout(20);
      assert.equal(await page.inputValue('#mlsVnTplText_plan'), 'CURRENT EDITOR CONTENT', scenario + ' accepted stale file content');
      assert.equal(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()) === window.__storeBeforeCompletion), true, scenario + ' changed storage');
      await page.evaluate(() => { delete window.__finishFile; });
    }
    await page.close();

    /* Exercise the real shell wrapper after a cold load outlives the gesture. */
    const cold = await browser.newPage();
    await cold.route('https://mls-cold-template.test/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: SHELL_HTML.replace('class="show"', 'class=""') }));
    await cold.goto('https://mls-cold-template.test/');
    await cold.evaluate(() => {
      window.uns = key => 'cold::' + key; window.getGenLength = () => 'standard'; window.getGenInstr = () => '';
      window.__messages = []; window.toast = text => window.__messages.push(text);
      window.openSettings = options => {
        if (!options || options.userInitiated !== true) return false;
        document.getElementById('settingsModal').classList.add('show'); return true;
      };
      window.__mlsEnsureDraftTuning = () => new Promise(resolve => { window.__finishLoad = resolve; });
    });
    await cold.addScriptTag({ content: lift('async function openVisitNoteTemplates(){', '\n/* settingsgate-1.0.0', 'visit template opener') });
    await cold.evaluate(() => { window.__opening = openVisitNoteTemplates(); });
    await cold.waitForTimeout(1100);
    await cold.addScriptTag({ path: MODULE_PATH });
    await cold.evaluate(() => window.__finishLoad(window.__mlsDraftTuning));
    assert.equal(await cold.evaluate(() => window.__opening), true, 'cold explicit intent was lost after await');
    assert.equal(await cold.locator('#mlsVisitNoteTemplatesSection:visible').count(), 1);
    await cold.evaluate(() => {
      window.__mlsEnsureDraftTuning = async () => null; window.__mlsDraftTuning = null;
      document.getElementById('settingsModal').classList.remove('show');
    });
    assert.equal(await cold.evaluate(() => openVisitNoteTemplates()), true, 'missing loader did not open Settings fallback');
    assert.match(await cold.evaluate(() => window.__messages.at(-1)), /Settings is open/);
    await cold.evaluate(() => { document.getElementById('settingsModal').classList.remove('show'); window.openSettings = () => false; });
    assert.equal(await cold.evaluate(() => openVisitNoteTemplates()), false, 'refused Settings opening claimed success');
    assert.match(await cold.evaluate(() => window.__messages.at(-1)), /could not be opened/);
    await cold.close();
  } finally {
    await browser.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('visit-note-templates-runtime.test.js: OK - the plain Visit note templates screen is the first card in ' +
    'Notes & AI, its paste/upload path is the shell\'s one file reader (.txt and a real .docx), Save writes the ' +
    'existing draftTuningV1 section contract and reaches the resolved generation tuning, Save settings no longer ' +
    'reverts it, Remove restores the shipped format, the op-note template library is byte-identical throughout, ' +
    'and no developer word reaches the screen');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
