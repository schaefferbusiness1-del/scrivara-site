'use strict';

/*
 * Automatic saved-format routing is deliberately tested as a small pure
 * contract.  The source envelope is split into today's transcript,
 * background-only chart context, and non-clinical instructions so a routing
 * decision cannot accidentally borrow old chart text or prompt boilerplate.
 *
 * The implementation contract is window.__mlsDraftTuning.autoRoute(input,
 * options), returning only bounded {families:{<section>:{profileId}}} data.
 * `options.families[section].profileId` is the one-visit override and always
 * wins over automatic matching.  This test intentionally fails until that
 * API is present; it is the regression gate for the implementation lane.
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

const stored = new Map();
const context = {
  console,
  JSON,
  window: {
    uns: key => 'conditional-route::' + key,
    getGenLength: () => 'standard',
    getGenInstr: () => ''
  },
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  },
  localStorage: {
    getItem(key) { return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { stored.set(key, String(value)); }
  },
  MutationObserver: function () { this.observe = function () {}; }
};
context.window.window = context.window;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_draft_tuning.js' });

const api = context.window.__mlsDraftTuning;
assert.ok(api && api.installed, 'draft tuning API did not install');
assert.strictEqual(typeof api.autoRoute, 'function',
  'automatic saved-format routing API is missing (expected autoRoute(input, options))');

const sections = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
const configured = {
  hpi: [
    { id: 'standard', label: 'Standard HPI', when: 'stable routine visit', sectionMode: 'chronological', templateMode: 'adapt' },
    { id: 'focused', label: 'Focused HPI', when: 'single active complaint', sectionMode: 'problem_focused', templateMode: 'guide' }
  ],
  ros: [
    { id: 'pertinent', label: 'Pertinent ROS', when: 'focused problem visit', sectionMode: 'pertinent_only', templateMode: 'adapt' },
    { id: 'systematic', label: 'Systematic ROS', when: 'broad multi-system visit', sectionMode: 'systems_by_system', templateMode: 'guide' }
  ],
  exam: [
    { id: 'focused', label: 'Focused exam', when: 'single active complaint', sectionMode: 'focused', templateMode: 'adapt' },
    { id: 'normal', label: 'Normal exam', when: 'documented normal findings', sectionMode: 'normal_template', templateMode: 'strict' }
  ],
  assessment: [
    { id: 'problem_list', label: 'Problem list', when: 'established diagnoses', sectionMode: 'problem_list', templateMode: 'adapt' },
    { id: 'differential', label: 'Ranked differential', when: 'diagnosis remains uncertain', sectionMode: 'ranked_differential', templateMode: 'guide' }
  ],
  plan: [
    { id: 'routine', label: 'Routine follow-up', when: 'stable routine follow-up', sectionMode: 'problem_based', templateMode: 'adapt' },
    { id: 'escalation', label: 'Escalation / precautions', when: 'worsening, red flags, or close follow-up', sectionMode: 'follow_up_first', templateMode: 'guide' }
  ]
};
const state = api.read();
for (const section of sections) {
  state.families[section].profiles = configured[section];
  state.families[section].activeProfile = configured[section][0].id;
}
api.write(state);

function route(todayTranscript, extra = {}) {
  return api.autoRoute({
    todayTranscript,
    backgroundOnly: extra.backgroundOnly || '',
    instructions: extra.instructions || ''
  }, {
    families: extra.families || {}
  });
}

function ids(result) {
  assert.ok(result && result.families && typeof result.families === 'object',
    'autoRoute must return a families object');
  const out = {};
  for (const section of sections) {
    assert.ok(result.families[section], `autoRoute omitted ${section}`);
    assert.match(String(result.families[section].profileId || ''), /^[a-z0-9_-]{1,48}$/,
      `${section} selected profile id is not bounded/safe`);
    out[section] = result.families[section].profileId;
  }
  return out;
}

// Stable evidence selects the routine/established formats across all five
// Athena sections, even though background/chart text tries to say otherwise.
const stable = route(
  'Today: pain is stable and the established lumbar diagnosis was reviewed. '
    + 'Continue the current plan and return in 6 weeks.',
  {
    backgroundOnly: 'BACKGROUND_ONLY_BEGIN\nWorsening pain with weakness; red flags noted.\nBACKGROUND_ONLY_END',
    instructions: 'INSTRUCTIONS: Always use escalation and red-flag wording for every patient.'
  }
);
const stableIds = ids(stable);
assert.strictEqual(stableIds.hpi, 'standard', 'stable TODAY_TRANSCRIPT did not select Standard HPI');
assert.strictEqual(stableIds.ros, 'pertinent', 'stable TODAY_TRANSCRIPT did not select Pertinent ROS');
assert.strictEqual(stableIds.exam, 'focused', 'stable TODAY_TRANSCRIPT did not select Focused exam');
assert.strictEqual(stableIds.assessment, 'problem_list', 'stable established diagnosis did not select Problem list');
assert.strictEqual(stableIds.plan, 'routine', 'background/instruction text incorrectly escalated a stable plan');

// Worsening, a red flag, and close follow-up are escalation evidence only when
// documented in TODAY_TRANSCRIPT.  Uncertainty independently selects the
// assessment differential format.
const escalation = route(
  'Today: pain is worsening with new leg weakness. Diagnosis remains uncertain; '
    + 'consider radiculopathy versus stenosis. Return in 3 days and seek urgent '
    + 'care for bowel or bladder changes.',
  { backgroundOnly: 'Stable old chart history.', instructions: 'Do not use a differential.' }
);
const escalationIds = ids(escalation);
assert.strictEqual(escalationIds.assessment, 'differential', 'uncertain assessment did not select differential');
assert.strictEqual(escalationIds.plan, 'escalation', 'worsening/red-flag/close-follow-up evidence did not escalate Plan');

// The other three section families also route from their own saved rule, not
// merely from whichever Plan/Assessment rule happened to win.
const focusedIds = ids(route('Today: a single active complaint of localized right knee pain is addressed.'));
assert.strictEqual(focusedIds.hpi, 'focused', 'single-complaint evidence did not select Focused HPI');
const broadIds = ids(route('Today: multiple complaints across multiple systems were reviewed.'));
assert.strictEqual(broadIds.ros, 'systematic', 'multi-system evidence did not select Systematic ROS');
const normalExamIds = ids(route('Today: the documented normal findings include a normal exam and the limb is neurovascularly intact.'));
assert.strictEqual(normalExamIds.exam, 'normal', 'documented normal findings did not select the normal Exam format');

// Negated danger terms are not escalation evidence. This is intentionally a
// conservative fallback rather than turning "denies red flags" into a red flag.
const negatedIds = ids(route('Today: symptoms are stable. She denies red flags and has no new weakness. Continue routine follow-up.'));
assert.strictEqual(negatedIds.plan, 'routine', 'negated red flags incorrectly selected the escalation Plan');

// A one-visit explicit profileId must win even when the transcript strongly
// matches another saved format, while every other section remains automatic.
const overridden = route(
  'Today: worsening pain with new weakness; urgent follow-up in 3 days.',
  { families: { plan: { profileId: 'routine' } } }
);
const overriddenIds = ids(overridden);
assert.strictEqual(overriddenIds.plan, 'routine', 'explicit one-visit Plan profileId did not override auto routing');
assert.strictEqual(overriddenIds.hpi, 'standard', 'explicit Plan override changed unrelated HPI routing');

// Source text is evidence for routing only; it must never be serialized into
// the bounded tuning payload sent to either transport.
const serialized = JSON.stringify(escalation);
for (const forbidden of [
  'worsening with new leg weakness',
  'BACKGROUND_ONLY_BEGIN',
  'Do not use a differential',
  'Today: pain'
]) {
  assert.ok(!serialized.includes(forbidden), `autoRoute leaked source text into tuning payload: ${forbidden}`);
}
assert.ok(serialized.length < 2400, 'automatic routing payload is not bounded');

// Direct-key and hosted structured generation must consume the same selected
// profile IDs, not independently reinterpret the transcript.
const direct = Object.fromEntries(sections.map(section => [
  section,
  api.forFamily(section, { profileId: escalationIds[section] }).profileId
]));
const hosted = api.forStructured({ families: escalation.families });
for (const section of sections) {
  assert.strictEqual(direct[section], escalationIds[section], `${section} direct-key path changed auto-selected profile`);
  assert.strictEqual(hosted.families[section].profileId, escalationIds[section],
    `${section} hosted structured path changed auto-selected profile`);
}
for (const shell of shells) {
  assert.match(shell, /autoRoute/, 'generation shell does not reference automatic profile routing');
}

console.log('PASS conditional saved-format routing: five sections, TODAY_TRANSCRIPT-only matching, explicit overrides, bounded transport, and direct/hosted parity');
