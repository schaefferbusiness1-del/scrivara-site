'use strict';

/* The simple Visit note templates surface owns visit families.  The richer
 * AI output-format editor remains available for every non-visit family. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'utf8');
const oneP = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');
const cloned = fs.readFileSync(path.join(root, 'cloned-feat_mls_draft_tuning.js'), 'utf8');
assert.strictEqual(source, oneP, 'canonical and 1p module drifted');
assert.strictEqual(source, cloned, 'canonical and cloned module drifted');

assert.match(source, /\['soap', 'Whole visit note \/ SOAP'/);
for (const family of ['hpi', 'ros', 'exam', 'assessment', 'plan']) {
  assert.match(source, new RegExp("\\['" + family + "', '"), family + ' is missing from the canonical visit editor');
}
assert.match(source, /id="mlsVnTplProfile_' \+ family/);
assert.match(source, /id="mlsVnTplAdd_' \+ family/);
assert.match(source, /id="mlsVnTplDelete_' \+ family/);
assert.match(source, /id="mlsVnTplClear_' \+ family/);
assert.match(source, /id="mlsVnTplExample_' \+ family/);
assert.match(source, /id="mlsVnTplExampleDerive_' \+ family/);
assert.match(source, /id="mlsVnTplExampleApply_' \+ family/);
assert.match(source, /id="mlsVnTplWhenSuggest_' \+ family/);
assert.match(source, /suggestWhen\(family, selected\.id/);
assert.match(source, /exampleImporter\(family, selected\.id\)/);
assert.doesNotMatch(source, /id="mlsVnTplRemove_' \+ family/);
for (const field of ['Name', 'When', 'SectionMode', 'Comments']) {
  assert.match(source, new RegExp('id="mlsVnTpl' + field + "_' \\+ family"), 'advanced visit profile field missing: ' + field);
}
assert.match(source, /MAX_SECTION_PROFILES/);
assert.match(source, /profileEditor\(family\)/);
assert.match(source, /document\.createElement\('option'\)/);
assert.match(source, /option\.textContent = String\(profile\.label \|\| profile\.id \|\| ''\)/);
assert.match(source, /del\.disabled = profiles\.length <= 1/);
assert.match(source, /function visitTemplateClear\(family\)/);
assert.match(source, /mlsVnTplName_' \+ family.*maxlength=\"80\"/);
assert.match(source, /mlsVnTplWhen_' \+ family.*maxlength=\"180\"/);
assert.match(source, /if \(mine && rows\.length > 1\)/);
assert.match(source, /visitTemplateSave\(family, text, visitTemplatePickedMode\(family\)\)/);
assert.match(source, /editor\.update\(targetId, \{ templateText: '', templateMode: 'guide' \}\)/,
  'Clear template must clear content without deleting the profile');
assert.match(source, /editor\.remove\(selectedId\)/,
  'Delete format must remove the selected profile');
assert.match(source, /mlsVnTplProfile_' \+ family\)\.addEventListener\('change'/,
  'saved-format selection must route through the canonical editor');
assert.match(source, /if \(q\('mlsVisitNoteTemplatesSection'\)\) \{ paintVisitTemplates\(\); return true; \}/,
  'visit editor mount is not idempotent');

/* Lower AI output formats must not expose SOAP/HPI/ROS/Exam/Assessment/Plan. */
assert.match(source, /FAMILY_IDS\.filter\(function \(id\) \{ return SECTION_FAMILIES\.indexOf\(id\) < 0 && id !== 'soap'; \}\)/);
for (const family of ['opnote', 'avs', 'referral', 'priorauth', 'legal_ime', 'copilot', 'studio_widget', 'coding', 'general_draft']) {
  assert.match(source, new RegExp("\\b" + family + "\\s*:"), family + ' non-visit family disappeared');
}

const store = new Map();
const document = { readyState: 'loading', getElementById() { return null; }, querySelector() { return null; }, addEventListener() {}, createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; } };
const window = { document, uns(key) { return 'acct::' + key; }, getGenLength() { return 'standard'; }, getGenInstr() { return ''; } };
window.window = window;
const context = { console, JSON, Object, Date, window, document, localStorage: {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); }
}, MutationObserver: function () { this.observe = function () {}; } };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_draft_tuning.js' });
const api = window.__mlsDraftTuning;
const editor = api.profileEditor('hpi');
const before = editor.list();
assert(before.length >= 2, 'HPI does not start with reusable profiles');
const added = editor.add({ id: 'routine_custom', label: 'Routine custom HPI', templateText: 'HPI headings', templateMode: 'strict' });
assert(added && added.id === 'routine_custom', 'canonical visit editor could not add a profile');
assert.strictEqual(editor.list().length, before.length + 1);
assert.strictEqual(editor.select('routine_custom').id, 'routine_custom');
assert.strictEqual(editor.update('routine_custom', { label: 'Edited HPI', templateText: 'Edited headings', templateMode: 'guide' }).label, 'Edited HPI');
assert(editor.remove('routine_custom'), 'canonical visit editor could not remove a profile');
assert.strictEqual(editor.list().length, before.length, 'profile removal did not restore the original list');

console.log('PASS visit template canonical surface: one idempotent per-section editor owns SOAP/HPI/ROS/Exam/Assessment/Plan, profiles add/select/rename/save/delete/clear through draftTuningV1, non-visit AI formats remain, and labels use DOM textContent');
