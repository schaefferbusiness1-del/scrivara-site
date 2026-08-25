'use strict';

/*
 * Each clinical section has its own reusable-format workspace.  This is a
 * deliberately narrow contract for the editor requested by the owner:
 * HPI, ROS, Exam, Assessment and Plan must each be independently editable,
 * conditionally routable and carried unchanged through both generation
 * transports.  The test names the small profileEditor API so the UI and the
 * transport code can share one account-scoped owner instead of maintaining
 * five subtly different settings implementations.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'utf8');
const p1Source = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');
const shells = [
  fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1'),
  fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'latin1'),
  fs.readFileSync(path.join(root, '1p', 'index.html'), 'latin1')
];

assert.strictEqual(source, p1Source, 'canonical and 1p draft-tuning modules diverged');

const store = new Map();
const document = {
  readyState: 'loading',
  getElementById() { return null; },
  querySelector() { return null; },
  addEventListener() {},
  createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; }
};
const window = {
  document,
  uns(key) { return 'account-alpha::' + key; },
  getGenLength() { return 'standard'; },
  getGenInstr() { return ''; }
};
window.window = window;
const context = {
  console,
  JSON,
  Object,
  Date,
  window,
  document,
  localStorage: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); }
  },
  MutationObserver: function () { this.observe = function () {}; }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_draft_tuning.js' });

const api = window.__mlsDraftTuning;
assert.ok(api && api.installed, 'draft tuning API did not install');
assert.strictEqual(typeof api.profileEditor, 'function',
  'missing shared profileEditor API for independently editable section formats');
for (const control of ['mlsDtSectionName', 'mlsDtSectionAdd', 'mlsDtSectionDelete', 'mlsDtSectionTemplateText', 'mlsDtSectionWhen', 'mlsDtInstructions']) {
  assert.ok(source.includes('id="' + control + '"'),
    'Settings is missing the named reusable-format control: ' + control);
}
assert.ok(source.includes('mls-dt-short-field'),
  'short saved-format controls do not have a compact-field class');
assert.ok(/id="mlsDtSectionName"[^>]*style="[^"]*min-height:0[^\"]*height:42px/.test(source) &&
  /id="mlsDtSectionWhen"[^>]*style="[^"]*min-height:0[^\"]*height:42px/.test(source),
  'format name and automatic-use controls still inherit the tall note editor height');
assert.ok(/id="mlsDtSectionTemplateText"[^>]*style="[^"]*min-height:150px[^\"]*height:150px/.test(source),
  'saved template outline must not inherit the 260px note editor height');
assert.ok(/id="mlsDtInstructions"[^>]*class="[^"]*mls-dt-comments-field[^\"]*"[^>]*style="[^"]*min-height:96px[^\"]*height:96px/.test(source) &&
  /id="mlsDtFamilyInstructions"[^>]*class="[^"]*mls-dt-comments-field[^\"]*"[^>]*style="[^"]*min-height:96px[^\"]*height:96px/.test(source),
  'AI comment fields must not inherit the 260px note editor height');
assert.ok(source.includes("processed through MLS\\'s authenticated AI services") &&
  source.includes('For images or scanned PDFs, MLS first performs temporary OCR') &&
  source.includes('removes common patient identifiers and embedded instructions') &&
  source.includes('review the preview before saving') &&
  source.includes('original example is used transiently, then cleared from this importer') &&
  source.includes('Only the reusable format fields are saved when you choose Apply and Save Settings'),
  'template importer disclosure does not explain authenticated processing, preview review, and transient raw-example handling truthfully');
assert.ok(source.includes('AI is building a reusable preview and removing patient-specific details from the result'),
  'template importer status overstates client-side redaction');
assert.ok(source.includes("q('mlsDtSectionImportExample').value = '';") &&
  source.includes("q('mlsDtSectionImportFile').value = '';"),
  'template importer does not clear the raw example after deriving its preview');

const sections = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
const marker = section => ({
  id: 'custom_' + section,
  label: 'Custom ' + section.toUpperCase(),
  templateText: section.toUpperCase() + ' OUTLINE: documented facts only; finish with a concise summary.',
  when: 'when today documents a custom ' + section + ' circumstance',
  instructions: 'AI prompt comments for ' + section + ': use only supported facts and preserve this outline.',
  sectionMode: section === 'plan' ? 'follow_up_first' : undefined,
  templateMode: 'adapt'
});

// Every section exposes the complete editor independently, not merely a
// read-only selector or a flat sectionMode.
for (const section of sections) {
  const editor = api.profileEditor(section);
  assert.ok(editor && typeof editor.list === 'function', section + ' editor cannot list formats');
  assert.strictEqual(typeof editor.add, 'function', section + ' editor cannot add a reusable format');
  assert.strictEqual(typeof editor.update, 'function', section + ' editor cannot edit a reusable format');
  assert.strictEqual(typeof editor.remove, 'function', section + ' editor cannot delete a reusable format');
  assert.strictEqual(typeof editor.select, 'function', section + ' editor cannot switch formats');
  assert.strictEqual(typeof editor.active, 'function', section + ' editor cannot report the selected format');

  const before = editor.list();
  assert.ok(before.length >= 1 && before.length <= 8, section + ' initial format count is outside the bounded range');
  const added = editor.add(marker(section));
  assert.strictEqual(added.id, 'custom_' + section, section + ' custom format was not added');
  assert.strictEqual(added.label, 'Custom ' + section.toUpperCase(), section + ' format name was not saved');
  assert.match(added.templateText, new RegExp(section.toUpperCase() + ' OUTLINE'), section + ' template outline was not saved');
  assert.match(added.when, new RegExp('custom ' + section), section + ' automatic-use rule was not saved');
  assert.match(added.instructions, new RegExp('AI prompt comments for ' + section), section + ' AI prompt comments were not saved');

  const revised = editor.update(added.id, {
    label: 'Revised ' + section.toUpperCase(),
    templateText: 'REVISED ' + section.toUpperCase() + ' OUTLINE',
    when: 'when today documents the revised ' + section + ' circumstance',
    instructions: 'Revised AI prompt comments for ' + section
  });
  assert.strictEqual(revised.label, 'Revised ' + section.toUpperCase(), section + ' profile name did not update');
  assert.strictEqual(revised.templateText, 'REVISED ' + section.toUpperCase() + ' OUTLINE', section + ' template body did not update');
  assert.match(revised.when, /revised/, section + ' use-when rule did not update');
  assert.match(revised.instructions, /Revised AI prompt comments/, section + ' AI comments did not update');
  assert.strictEqual(editor.select(revised.id).id, revised.id, section + ' profile could not be selected');
  assert.strictEqual(editor.active().id, revised.id, section + ' selected profile was not retained');
}

// Profile data is account-namespaced, scrubbed and bounded.  A malicious
// payload cannot create a ninth format or leak patient/source text into the
// reusable profile store.
const state = api.read();
const configuredSnapshot = JSON.parse(JSON.stringify(state));
for (const section of sections) {
  state.families[section].profiles = Array.from({ length: 12 }, (_, i) => ({
    id: 'overflow_' + i,
    label: 'Format ' + i,
    templateText: 'Template ' + i,
    when: 'When ' + i,
    instructions: '\u0000patient Jane Doe ' + 'x'.repeat(2000)
  }));
}
const cleaned = api.write(state);
for (const section of sections) {
  assert.ok(cleaned.families[section].profiles.length <= 8, section + ' exceeded the eight-format limit');
  for (const profile of cleaned.families[section].profiles) {
    assert.ok(profile.instructions.length <= 600, section + ' AI comments exceeded the bounded length');
    assert.ok(!profile.instructions.includes('\u0000'), section + ' AI comments retained control characters');
  }
}
assert.ok(store.has('account-alpha::draftTuningV1'), 'formats were not stored under the account namespace');
assert.ok(!String(store.get('account-alpha::draftTuningV1')).includes('Jane Doe'),
  'patient/source text leaked into reusable profile persistence');

// Restore the intentionally valid custom profiles before the selection and
// transport checks below; the overflow payload above is an isolated hostile
// persistence probe, not a new user configuration.
api.write(configuredSnapshot);

// Switching one section must never overwrite another section's format or
// active selection.
const beforeSwitch = api.read();
const rosBefore = JSON.stringify(beforeSwitch.families.ros);
const planBefore = JSON.stringify(beforeSwitch.families.plan);
const hpiEditor = api.profileEditor('hpi');
hpiEditor.select('overflow_1');
const afterSwitch = api.read();
assert.notStrictEqual(afterSwitch.families.hpi.activeProfile, beforeSwitch.families.hpi.activeProfile,
  'HPI selection did not change');
assert.strictEqual(JSON.stringify(afterSwitch.families.ros), rosBefore, 'HPI switch overwrote ROS');
assert.strictEqual(JSON.stringify(afterSwitch.families.plan), planBefore, 'HPI switch overwrote Plan');

// The editor cannot remove the final remaining profile and always enforces
// the same bound through repeated adds.
for (const section of sections) {
  const editor = api.profileEditor(section);
  const profiles = editor.list();
  for (const profile of profiles.slice(0, -1)) editor.remove(profile.id);
  assert.strictEqual(editor.list().length, 1, section + ' editor deleted the final profile');
  assert.strictEqual(editor.remove(editor.list()[0].id), false, section + ' editor allowed deleting the final profile');
  for (let i = 0; i < 12; i++) editor.add({ id: section + '_bounded_' + i, label: 'Bounded ' + i, templateText: 'T', when: 'W', instructions: 'I' });
  assert.ok(editor.list().length <= 8, section + ' editor exceeded eight profiles after repeated adds');
}

// Automatic routing uses the saved “when” rule, while an explicit one-visit
// profileId wins for that section only.  The selected profile’s template and
// prompt comments are visible to both direct-key and hosted structured paths.
const routeInput = { todayTranscript: 'TODAY_TRANSCRIPT_BEGIN\nToday documents the revised hpi circumstance and a broad multi-system visit.\nTODAY_TRANSCRIPT_END' };
const auto = api.autoRoute(routeInput, {});
assert.ok(auto.families && auto.families.hpi && auto.families.ros, 'automatic routing omitted section selections');
const explicit = api.autoRoute(routeInput, { families: { hpi: { profileId: 'custom_hpi' }, plan: { profileId: 'custom_plan' } } });
assert.strictEqual(explicit.families.hpi.profileId, 'custom_hpi', 'one-visit HPI override lost to automatic routing');
assert.strictEqual(explicit.families.plan.profileId, 'custom_plan', 'one-visit Plan override lost to automatic routing');
const direct = api.forFamily('hpi', { profileId: 'custom_hpi' });
const hosted = api.forStructured({ families: { hpi: { profileId: 'custom_hpi' }, ros: { profileId: 'custom_ros' }, exam: { profileId: 'custom_exam' }, assessment: { profileId: 'custom_assessment' }, plan: { profileId: 'custom_plan' } } });
for (const section of sections) {
  const payload = section === 'hpi' ? direct : api.forFamily(section, { profileId: 'custom_' + section });
  const hostedSection = hosted.families[section];
  assert.strictEqual(payload.profileId, 'custom_' + section, section + ' direct transport changed selected profile');
  assert.strictEqual(hostedSection.profileId, 'custom_' + section, section + ' hosted transport changed selected profile');
  assert.match(String(payload.templateText || payload.profileTemplateText || ''), new RegExp(section.toUpperCase()), section + ' direct transport dropped template outline');
  assert.match(String(payload.instructions || ''), new RegExp('AI prompt comments for ' + section), section + ' direct transport dropped AI prompt comments');
  assert.match(String(hostedSection.templateText || hostedSection.profileTemplateText || ''), new RegExp(section.toUpperCase()), section + ' hosted transport dropped template outline');
  assert.match(String(hostedSection.instructions || ''), new RegExp('AI prompt comments for ' + section), section + ' hosted transport dropped AI prompt comments');
}
const directPrompt = api.promptBlock('hpi', { profileId: 'custom_hpi' });
const hostedPrompt = api.promptBlock('soap', { families: hosted.families });
assert.match(directPrompt, /REVISED HPI OUTLINE/, 'direct prompt omitted selected HPI template');
assert.match(directPrompt, /AI prompt comments for hpi/, 'direct prompt omitted selected HPI AI comments');
for (const section of sections) {
  assert.match(hostedPrompt, new RegExp('REVISED ' + section.toUpperCase() + ' OUTLINE'), section + ' hosted prompt omitted its selected template');
  assert.match(hostedPrompt, new RegExp('AI prompt comments for ' + section), section + ' hosted prompt omitted its AI comments');
}

// A section-format preference never becomes an unbounded second transport or
// an alternate account store.  Both hosted and direct shells must advertise
// the same tuning handoff.
for (const shell of shells) {
  assert.match(shell, /draftTuningV1/, 'generation shell omitted account-scoped tuning persistence');
  assert.match(shell, /draftTuning/, 'generation shell omitted the shared tuning payload');
}
assert.ok(JSON.stringify(api.read()).length < 28000, 'section profile store is not bounded');

console.log('PASS section format profiles: independent CRUD, account scope, bounded profiles, conditional routing, one-visit overrides, and direct/hosted parity');
