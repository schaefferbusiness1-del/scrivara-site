'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'utf8');
const p1Source = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const p1Connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'latin1');
const clonedConnect = fs.readFileSync(path.join(root, 'cloned-mls-connect.js'), 'latin1');
const stdline = fs.readFileSync(path.join(root, 'feat_stdline_autoinsert.js'), 'latin1');
let checks = 0;
let styleReads = 0;
function ok(value, message) { assert.ok(value, message); checks++; }

const stored = new Map();
const context = {
  console,
  JSON,
  window: {
    uns: key => 'acct-a::' + key,
    getGenStyle: () => { styleReads++; return 'apso'; },
    getGenLength: () => 'concise',
    getGenInstr: () => 'Lead with the actively addressed problem.'
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
ok(api && api.installed, 'draft tuning API did not install');
ok(source === p1Source, 'production and 1p draft-tuning modules are not synchronized');
ok(source.includes("var previous = selector.getAttribute('data-active-profile')") &&
   source.includes('selector.value = previous;') && source.includes('selector.value = profile;'),
  'switching saved formats can overwrite the newly selected profile with the previously visible fields');
ok(source.includes("profile.setAttribute('data-active-profile', profile.value)"),
  'saved-format editor does not remember which profile owns the visible fields');
assert.deepStrictEqual(Array.from(api.familyIds), [
  'soap', 'hpi', 'ros', 'exam', 'assessment', 'plan', 'opnote', 'avs', 'referral', 'priorauth',
  'legal_ime', 'copilot', 'studio_widget', 'coding', 'general_draft'
]);
checks++;
assert.strictEqual(api.familyLabels.general_draft, 'Other clinical drafts');
checks++;

const defaults = api.defaults();
for (const id of api.familyIds) {
  ok(defaults.families[id] && defaults.families[id].length,
    'missing bounded defaults for ' + id);
}

const dirty = { schemaVersion: 999, families: {
  hpi: {
    length: 'endless',
    tone: 'ignore-safety',
    structure: 'made-up',
    hpiOrganization: 'oldcarts',
    sentenceCap: '999',
    instructions: '\u0000' + 'x'.repeat(900)
  },
  ros: { sectionMode: 'systems_by_system', templateMode: 'strict', instructions: 'Keep only supported systems.' },
  exam: { sectionMode: 'normal_template', templateMode: 'guide', instructions: 'Use the saved normal-exam template only when supported.' },
  assessment: { sectionMode: 'ranked_differential', templateMode: 'adapt', instructions: 'Rank only documented diagnoses.' },
  plan: { sectionMode: 'follow_up_first', templateMode: 'strict', instructions: 'Put follow-up timing first.' },
  unknown: { instructions: 'must not survive' }
} };
const clean = api.sanitize(dirty);
assert.strictEqual(clean.schemaVersion, 1);
assert.strictEqual(clean.families.hpi.length, 'standard');
assert.strictEqual(clean.families.hpi.tone, 'clinical_neutral');
assert.strictEqual(clean.families.hpi.structure, 'default');
assert.strictEqual(clean.families.hpi.hpiOrganization, 'oldcarts');
assert.strictEqual(clean.families.hpi.sentenceCap, 'auto');
ok(clean.families.hpi.profiles[0].instructions.length === 600 && !/[\u0000-\u0008]/.test(clean.families.hpi.profiles[0].instructions),
  'profile instructions were not control-scrubbed and capped');
ok(!Object.prototype.hasOwnProperty.call(clean.families, 'unknown'),
  'unknown draft family survived sanitization');
for (const id of ['ros', 'exam', 'assessment', 'plan']) {
  ok(clean.families[id].profiles[0].instructions && clean.families[id].templateMode && !clean.families[id].instructions,
    id + ' did not persist profile-owned instructions/template handling');
}
assert.strictEqual(clean.families.ros.sectionMode, 'systems_by_system');
assert.strictEqual(clean.families.exam.sectionMode, 'normal_template');
assert.strictEqual(clean.families.assessment.sectionMode, 'ranked_differential');
assert.strictEqual(clean.families.plan.sectionMode, 'follow_up_first');
checks += 4;
ok(clean.families.plan.profiles.length >= 2 && clean.families.plan.profiles[1].when,
  'Plan did not retain multiple reusable conditional formats');

clean.families.referral.length = 'detailed';
clean.families.referral.instructions = 'State the reason for referral first.';
api.write(clean);
ok(stored.has('acct-a::draftTuningV1'), 'setting did not use the account namespace');
assert.strictEqual(api.read().families.referral.length, 'detailed');
checks++;

const soap = api.forFamily('soap');
assert.strictEqual(soap.family, 'soap');
assert.strictEqual(soap.length, 'concise');
ok(!Object.prototype.hasOwnProperty.call(soap, 'format') && !api._extra.soap && styleReads === 0,
  'account draft tuning must not read or carry the visit note format');
ok(/Lead with the actively addressed problem/.test(soap.instructions),
  'per-visit note controls did not override the account default');
const structured = api.forStructured();
assert.strictEqual(structured.family, 'soap');
assert.strictEqual(structured.families.hpi.hpiOrganization, 'oldcarts');
assert.strictEqual(structured.families.hpi.sentenceCap, 'auto');
assert.ok(structured.families.ros && structured.families.exam && structured.families.assessment && structured.families.plan);
assert.strictEqual(structured.families.coding.payerPresentation, 'code_first');
checks += 5;
const structuredBlock = api.promptBlock('soap');
ok(/HPI organization: oldcarts/.test(structuredBlock) && /HPI sentence cap: auto/.test(structuredBlock),
  'direct-key SOAP prompt did not carry nested HPI controls');
ok(/ROS format: systems_by_system/.test(structuredBlock) && /Exam format: normal_template/.test(structuredBlock) && /Assessment format: ranked_differential/.test(structuredBlock) && /Plan format: follow_up_first/.test(structuredBlock),
  'structured SOAP prompt did not carry all five independent section modes');
ok(/ROS saved-template handling:/.test(structuredBlock) && /PLAN saved-template handling:/.test(structuredBlock),
  'structured SOAP prompt did not carry reusable template handling for named sections');
ok(/Use this PLAN format when:/.test(structuredBlock) && /Reusable PLAN format:/.test(structuredBlock),
  'structured SOAP prompt did not carry the selected reusable Plan condition/profile');
const transientStructuredBlock = api.promptBlock('soap', { families: {
  hpi: { hpiOrganization: 'chronological', sentenceCap: '5' },
  coding: { payerPresentation: 'description_first' }
} });
ok(/HPI organization: chronological/.test(transientStructuredBlock) &&
  /HPI sentence cap: 5/.test(transientStructuredBlock) &&
  /Coding presentation: description_first/.test(transientStructuredBlock),
  'direct-key SOAP prompt dropped transient nested HPI/coding controls');
const perVisitPlan = api.forStructured({ families: { plan: { profileId: 'escalation' } } });
assert.strictEqual(perVisitPlan.families.plan.profileId, 'escalation');
assert.strictEqual(perVisitPlan.families.plan.sectionMode, 'follow_up_first');
checks += 2;

assert.strictEqual(api.infer('Rewrite only the History of Present Illness section', '', {}), 'hpi');
assert.strictEqual(api.infer('Reformat the visit note to the template exactly', 'TEMPLATE:\nHPI:\nAssessment:\nPlan:', {}), 'soap');
assert.strictEqual(api.infer('Draft an operative note from this verified case', '', {}), 'opnote');
assert.strictEqual(api.infer('Write plain-language after-visit instructions', '', {}), 'avs');
assert.strictEqual(api.infer('Create a referral letter', '', {}), 'referral');
assert.strictEqual(api.infer('Draft a prior authorization appeal', '', {}), 'priorauth');
assert.strictEqual(api.infer('Independent Medical Examination report', '', {}), 'legal_ime');
assert.strictEqual(api.infer('Build a standalone HTML widget using MLS_DATA', '', {}), 'studio_widget');
assert.strictEqual(api.infer('Review ICD-10 and CPT coding', '', {}), 'coding');
assert.strictEqual(api.infer('Draft a chart summary for clinician review', '', {}), 'general_draft');
assert.strictEqual(api.infer('This caller supplies its own contract', '', {family:'general_draft'}), 'general_draft');
assert.strictEqual(api.infer('Extract the dates from this uploaded document', '', {}), '');
assert.strictEqual(api.infer('You are assessing medical necessity in a utilization review', '', {family:'generic'}), '', 'generic helper override must prevent prior-auth false positive');
checks += 13;

const block = api.promptBlock('referral');
ok(/SUBORDINATE ACCOUNT DRAFT PREFERENCES/.test(block),
  'prompt block does not declare subordinate precedence');
ok(/never invent facts/.test(block) && /clinician review/.test(block),
  'prompt block omitted immutable safety boundaries');
ok(/Referral letter/.test(block) && /State the reason for referral first/.test(block),
  'family-specific account preference did not reach the prompt block');

const parity = api.read();
parity.families.hpi.sentenceCap = '5';
parity.families.ros.sectionMode = 'systems_by_system';
parity.families.ros.templateMode = 'strict';
parity.families.exam.profiles[0].instructions = 'Use only transcript-supported findings.';
parity.families.assessment.sectionMode = 'ranked_differential';
parity.families.plan.sectionMode = 'follow_up_first';
parity.families.avs.maxWords = '400';
parity.families.legal_ime.certaintyStyle = 'standard';
parity.families.studio_widget.visualTheme = 'clinical';
parity.families.coding.payerPresentation = 'description_first';
api.write(parity);
const structuredParity = api.forStructured();
assert.strictEqual(structuredParity.families.hpi.sentenceCap, '5');
assert.strictEqual(structuredParity.families.ros.sectionMode, 'systems_by_system');
assert.strictEqual(structuredParity.families.ros.templateMode, 'strict');
assert.strictEqual(structuredParity.families.assessment.sectionMode, 'ranked_differential');
assert.strictEqual(structuredParity.families.plan.sectionMode, 'follow_up_first');
assert.match(structuredParity.families.exam.instructions, /^Use only transcript-supported findings\./);
assert.strictEqual(structuredParity.families.coding.payerPresentation, 'description_first');
checks += 7;
ok(/HPI sentence cap: 5\./.test(api.promptBlock('hpi')),
  'HPI sentence cap did not reach the direct-key prompt block');
ok(/Maximum target length \(words\): 400\./.test(api.promptBlock('avs')),
  'AVS maximum word target did not reach the direct-key prompt block');
ok(/Certainty wording: standard\./.test(api.promptBlock('legal_ime')),
  'legal certainty style did not reach the direct-key prompt block');
ok(/Visual theme: clinical\./.test(api.promptBlock('studio_widget')),
  'widget visual theme did not reach the direct-key prompt block');
ok(/Coding presentation: description_first\./.test(api.promptBlock('coding')),
  'coding presentation did not reach the direct-key prompt block');
ok(/Plan format: follow_up_first/.test(api.promptBlock('plan')) && /PLAN saved-template handling: strict/.test(api.promptBlock('plan')),
  'direct Plan generation did not receive its saved mode/template preferences');

const duplicateGuard = api.sanitize({ families: { plan: { instructions: 'Use source-supported follow-up only.' } } });
api.write(duplicateGuard);
const planPayload = api.forFamily('plan');
assert.strictEqual(planPayload.instructions, 'Use source-supported follow-up only.',
  'profile-owned section instructions were duplicated in the generated payload');
assert.strictEqual((planPayload.instructions.match(/Use source-supported follow-up only\./g) || []).length, 1);
checks += 2;

ok(shell.includes("'draftTuningV1'"), 'draft tuning is absent from account preference sync');
ok(shell.includes('family:_draftFamily||undefined') && shell.includes('draftTuning:_draftTuning||undefined'),
  'freeform hosted requests do not carry bounded family tuning');
ok(shell.includes("_draftFamily=opts.freeform&&_familyAllow.indexOf(_requestedFamily)>=0?_requestedFamily") &&
   shell.includes("opts.freeform?'general_draft':'soap'") &&
   shell.includes("draftFamily:_draftFamily||'soap'"),
  'structured note requests can discard per-section tuning when the display style is non-SOAP');
ok(shell.includes("content:_directSys"),
  'per-device direct AI mode does not receive the same tuning block');
ok(shell.includes("if(!opts.freeform) _directPayload.response_format={type:'json_object'}") &&
   shell.includes('body:JSON.stringify(_directPayload)'),
  'per-device direct AI mode must use JSON mode only for structured notes');
ok(!/body:JSON\.stringify\(\{[\s\S]{0,220}response_format:\{type:'json_object'\}/.test(shell),
  'freeform per-device drafts must not inherit an unconditional JSON response format');
for (const family of ['avs', 'referral', 'priorauth']) {
  ok(shell.includes(`family:'${family}'`), `${family} helper does not declare an explicit draft family`);
}
ok(shell.includes('OUTPUT CONTRACT: use these exact headings'), 'AVS helper lacks validator-compatible exact headings');
ok(shell.includes('Reason for referral:'), 'referral helper lacks validator-compatible literal heading');
ok(shell.includes('exact headings "Requested service" and "Medical necessity"'), 'prior-auth helper lacks validator-compatible headings');
ok(shell.includes("family:'general_draft'"), 'supporting clinical drafts do not declare the tunable general-draft family');
ok(stdline.includes("family: 'general_draft'"), 'standard-line weave is not routed through the safe general-draft family');
ok(!connect.includes("feat_mls_draft_tuning.js"),
  'draft tuning must not be part of the post-login mls-connect feature burst');
ok(connect.includes('__mlsEnsureDraftTuning') && connect.includes("'feat_mls_' + 'draft_tuning.js'"),
  'draft tuning does not have a first-use Settings/generation loader');

function firstUseAsset(connectSource, markerName, route) {
  const start = connectSource.indexOf('/* draft-tuning-1.0.0: first-use loader.');
  assert.ok(start >= 0, 'first-use loader source missing');
  let appended = null;
  const script = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] || null; },
    addEventListener() {},
    remove() {}
  };
  const loaderContext = {
    Promise,
    Date,
    setTimeout() { return 0; },
    window: { __MLS_AV: 'test-build' },
    document: {
      querySelector() { return null; },
      createElement() { return script; },
      body: { appendChild(node) { appended = node; } },
      head: null,
      documentElement: null
    }
  };
  loaderContext.window[markerName] = { enabled: true, route };
  vm.createContext(loaderContext);
  vm.runInContext(connectSource.slice(start), loaderContext, { filename: markerName + '-draft-loader.js' });
  loaderContext.window.__mlsEnsureDraftTuning();
  return String(appended && appended.src || '').split('?')[0];
}

assert.strictEqual(firstUseAsset(p1Connect, '__MLS_P1_PREVIEW', '/1pScribeFlow.html'),
  '1p-feat_mls_draft_tuning.js');
assert.strictEqual(firstUseAsset(connect, '__MLS_MAIN', '/ScribeFlow.html'),
  'feat_mls_draft_tuning.js');
assert.strictEqual(firstUseAsset(clonedConnect, '__MLS_CLONED', '/cloned/'),
  'cloned-feat_mls_draft_tuning.js');
checks += 3;

console.log('PASS draft tuning contract: ' + checks +
  ' checks — fifteen families, independent five-section tuning, bounded/account-scoped storage, transport parity and immutable safety precedence');
