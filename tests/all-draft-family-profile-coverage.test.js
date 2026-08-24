'use strict';

/* Causal contract for the account settings promise: every draft family must
 * expose the same bounded saved-format primitives, not just length/tone. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');
const stored = new Map();
const context = {
  console, JSON, Promise,
  window: {
    uns: key => 'acct-profile::' + key,
    bkBase: () => 'https://example.test',
    bkToken: () => 'test-token'
  },
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
  localStorage: { getItem(key) { return stored.get(key) || null; }, setItem(key, value) { stored.set(key, String(value)); } },
  MutationObserver: function () { this.observe = function () {}; },
  setTimeout, clearTimeout
};
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
vm.createContext(context);
vm.runInContext(source, context, { filename: '1p-feat_mls_draft_tuning.js' });
const api = context.window.__mlsDraftTuning;
assert.ok(api && api.installed, 'draft-tuning API did not install');

for (const id of api.familyIds) {
  const state = api.defaults().families[id];
  assert.ok(Array.isArray(state.profiles) && state.profiles.length >= 2, `${id} lacks multiple saved formats`);
  for (const profile of state.profiles) {
    assert.ok(profile.id && profile.label && Object.prototype.hasOwnProperty.call(profile, 'when'), `${id} profile lacks conditional rule`);
    assert.ok(Object.prototype.hasOwnProperty.call(profile, 'templateText'), `${id} profile lacks reusable template text`);
    assert.ok(Object.prototype.hasOwnProperty.call(profile, 'instructions'), `${id} profile lacks AI prompt comments`);
  }
  assert.ok(api.profiles(id).length >= 2, `${id} profiles API is not exposed`);
  assert.ok(api.profileEditor(id), `${id} profile editor is not exposed`);
  assert.ok(api.exampleImporter(id, state.profiles[0].id), `${id} example importer is not exposed`);

  const chosen = api.profileEditor(id).add({
    id: 'causal_' + id,
    label: 'Causal format',
    when: 'red flag documented',
    sectionMode: 'problem_grouped',
    templateMode: 'strict',
    templateText: id.toUpperCase() + ':\nDOCUMENTED FACTS ONLY',
    instructions: 'Use this format only when its rule is supported.'
  });
  assert.ok(chosen && chosen.id === 'causal_' + id, `${id} could not save a custom format`);
  const payload = api.forFamily(id, { profileId: chosen.id });
  assert.strictEqual(payload.profileId, chosen.id, `${id} did not select its saved format`);
  assert.match(payload.templateText, new RegExp(id.toUpperCase()), `${id} template did not reach payload`);
  assert.strictEqual(payload.profileWhen, 'red flag documented', `${id} conditional rule did not reach payload`);
  assert.match(payload.instructions, /Use this format only when its rule is supported/, `${id} AI comments did not reach payload`);
  assert.match(api.promptBlock(id, { profileId: chosen.id }), new RegExp(id.toUpperCase() + ' saved-template handling'), `${id} prompt omitted template handling`);
}

/* Generic families retain the pre-profile account-wide instruction channel
 * when a profile is edited.  The old section families intentionally migrate
 * that flat field into their selected profile instead. */
const genericState = api.read();
genericState.families.referral.instructions = 'Preserve the established referral voice.';
api.write(genericState);
api.profileEditor('referral').update('causal_referral', { label: 'Updated referral format' });
assert.strictEqual(api.read().families.referral.instructions, 'Preserve the established referral voice.',
  'editing a generic profile erased the legacy account-wide instruction');

/* SOAP is itself a profile family, and its selected format must survive the
 * structured note wrapper rather than disappearing at the wrapper boundary. */
const structuredSoap = api.forStructured();
assert.strictEqual(structuredSoap.profileId, api.read().families.soap.activeProfile, 'structured SOAP lost selected profile id');
assert.ok(structuredSoap.profileName && structuredSoap.profileWhen, 'structured SOAP lost selected profile metadata');
assert.ok(Object.prototype.hasOwnProperty.call(structuredSoap, 'templateMode') &&
  Object.prototype.hasOwnProperty.call(structuredSoap, 'templateText'), 'structured SOAP lost selected template fields');
assert.match(structuredSoap.templateText, /SOAP/, 'structured SOAP selected template did not reach payload');

const routes = api.autoRoute({ todayTranscript: 'TODAY_TRANSCRIPT_BEGIN\nred flag documented\nTODAY_TRANSCRIPT_END' });
for (const id of api.familyIds) assert.ok(routes.families[id] && routes.families[id].profileId, `${id} is missing automatic profile routing`);

console.log('PASS all-draft-family profile coverage: every family has multiple conditional formats, templates, AI comments, editor/importer APIs, payload reach, and routing');
