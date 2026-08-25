'use strict';

/* The first-run checklist must make account-scoped AI section formats
 * discoverable without creating a second settings owner or carrying visit
 * data into onboarding. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const firstRun = fs.readFileSync(path.join(root, 'feat_mls_firstrun.js'), 'utf8');
const tuning = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'utf8');

assert(firstRun.includes('id="mlsFrAiBtn"'), 'first-run checklist has no AI formats CTA');
assert(/key: 'tuning'[\s\S]{0,260}Configure AI note formats/.test(firstRun),
  'AI formats is not represented as an explicit checklist row');
assert(/Get MLS working - 0 of 4 done/.test(firstRun) && /done === 4/.test(firstRun),
  'the checklist does not count AI configuration honestly');
assert(/on\(byId\('mlsFrAiBtn'\),\s*'click',\s*onAiClick\)/.test(firstRun),
  'AI formats CTA is not wired into the checklist lifecycle');
assert(/async function onAiClick\(\)[\s\S]{0,1200}window\.openSettings/.test(firstRun),
  'AI formats CTA does not reuse canonical Settings');
const aiHandler = firstRun.slice(firstRun.indexOf('async function onAiClick()'), firstRun.indexOf('function onPullClick()'));
assert(!/markDone\s*\(/.test(aiHandler), 'AI formats CTA must not dismiss or complete setup');
assert(/__mlsEnsureDraftTuning[\s\S]{0,300}await/.test(aiHandler) || /await[\s\S]{0,300}__mlsEnsureDraftTuning/.test(aiHandler),
  'Configure does not await the canonical draft-tuning loader');
assert(/function focusAiFormats\([\s\S]{0,1400}mlsDraftTuningSection/.test(firstRun),
  'AI formats CTA does not target the mounted draft-tuning section');
assert(/data-mls-settings-group=\\?['"]notes/.test(firstRun) && /scrollIntoView/.test(firstRun) && /\.focus/.test(firstRun),
  'AI formats CTA does not select Notes & AI and focus the format controls');
assert(/AI note formats for HPI, ROS, Exam, Assessment and Plan/.test(firstRun),
  'Settings tour step does not identify all configurable note sections');
assert(/documented circumstance applies/.test(firstRun),
  'Settings tour step does not explain conditional-format use');
assert(firstRun.includes("on(window, 'mls:draft-tuning-saved', onSignal)"),
  'first-run checklist does not repaint from saved draft-tuning truth');
assert(tuning.includes("new CustomEvent('mls:draft-tuning-saved')"),
  'draft-tuning save does not signal the first-run truth reader');

/* Existing tuning transport is the natural one-visit hook: section profiles
 * are account-bounded and a request may select a profile explicitly. */
for (const family of ['hpi', 'ros', 'exam', 'assessment', 'plan']) {
  assert(new RegExp("\\b" + family + "\\s*:").test(tuning), family + ' profile family missing');
}
assert(/profiles/.test(tuning) && /profileId/.test(tuning),
  'draft tuning has no bounded reusable-profile or one-visit selection path');
assert(/forStructured\s*:\s*structuredFamily/.test(tuning),
  'structured generation has no natural one-visit tuning hook');

function tuningTruth(raw) {
  const store = new Map();
  if (raw !== undefined) store.set('acct::draftTuningV1', raw);
  const document = {
    readyState: 'loading',
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; },
    addEventListener() {},
    removeEventListener() {},
    contains() { return false; },
    body: { appendChild() {} },
    head: { appendChild() {} },
    documentElement: { appendChild() {} }
  };
  const window = {
    uns(key) { return 'acct::' + key; },
    document,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  const context = {
    window, document,
    localStorage: { getItem(key) { return store.has(key) ? store.get(key) : null; }, setItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    Date, Object, console,
    setTimeout() { return 1; },
    clearTimeout() {}
  };
  window.window = window;
  vm.runInNewContext(firstRun, context, { filename: 'feat_mls_firstrun.js' });
  return window.__mlsFirstRun._truth.tuning();
}

assert.strictEqual(tuningTruth(undefined), 'bad', 'an absent draft-tuning save was treated as configured');
assert.strictEqual(tuningTruth('{"schemaVersion":1,"families":{}}'), 'bad', 'an incomplete draft-tuning save was treated as configured');
assert.strictEqual(tuningTruth('{"schemaVersion":1,"families":{"hpi":{},"ros":{},"exam":{},"assessment":{},"plan":{}}}'), 'ok', 'a valid account-scoped draft-tuning save did not complete the row');
assert.strictEqual(tuningTruth('{not-json'), 'wait', 'an unreadable draft-tuning store was falsely called configured');

console.log('PASS first-run AI tuning entry: checklist CTA reuses Settings; setup state and visit data remain untouched');
