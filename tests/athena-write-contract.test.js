'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const writeflow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const contractSource = between(
  background,
  "var ROUTE_CONTRACT_VERSION = 'athena-routes-1';",
  '/* ---- normalizers (identical to the proven visits driver)'
);
const contract = Function(`${contractSource}\nreturn { version: ROUTE_CONTRACT_VERSION, aliases: ROUTE_ALIASES, policy: ROUTE_POLICY, canonical: canonicalRouteKey };`)();

assert(/^athena-routes-\d+$/.test(contract.version), 'typed write routes must stay versioned');
assert.strictEqual(contract.canonical('hpi'), 'hpi');
assert.strictEqual(contract.canonical('history'), '', 'ambiguous history must never route to a drawer or generic note');
assert.strictEqual(contract.canonical('past_surgical_history'), 'past_surgical_history');
assert.strictEqual(contract.canonical('followup'), 'follow_up');
assert.strictEqual(contract.canonical('totally_unknown'), '');

for (const key of ['encounter_note', 'hpi', 'ros', 'physical_exam', 'assessment_narrative', 'plan', 'follow_up']) {
  assert.strictEqual(contract.policy[key].draft, true, `${key} should be a supervised narrative draft route`);
}
for (const key of ['procedure_note', 'past_surgical_history', 'diagnoses_icd10', 'medications_rx', 'orders_preview', 'lab_order', 'imaging_order', 'referral_order', 'pt_order']) {
  assert.strictEqual(contract.policy[key].draft, false, `${key} must remain preview/target-only`);
}
for (const key of ['billing_preview', 'billing_em', 'billing_cpt']) {
  assert.notStrictEqual(contract.policy[key].draft, true, `${key} must not become a generic narrative draft route`);
}

const defsSource = between(background, 'var DEFS = {', 'function bestFieldFor(key)');
const defs = Function(`${defsSource}\nreturn DEFS;`)();
assert(defs.hpi.test('History of Present Illness'));
assert(!defs.hpi.test('Surgical & Procedure History'));
assert(defs.past_surgical_history.test('Surgical & Procedure History'));
assert(defs.diagnoses_icd10.test('Add Assessment ICD-10'));
assert(!defs.assessment_narrative.test('Add Charge CPT'));

const fieldPicker = between(background, 'function bestFieldFor(key)', '/* ---- History-pane navigation');
assert(!/DEFS\.note/.test(fieldPicker), 'field picker must not have a generic note fallback');
assert(!/\+?=\s*9000/.test(fieldPicker), 'focused fields must not outrank exact destinations');
assert(/if \(!re\) return null/.test(fieldPicker));

const writer = between(background, 'async function writeField(', '/* ---- run the sections');
assert(!writer.includes('\\u200B'), 'zero-width placeholders are not valid deletion/persistence evidence');
assert(!/persisted\s*=\s*true/.test(writer), 'same-editor readback must never claim persistence');
assert(/serverVerified:\s*false/.test(writer));
assert(/replace-needs-explicit-confirmation/.test(writer));
assert(/empty-write-disabled/.test(writer), 'generic deletion must be disabled');

const v2Start = background.indexOf("if (!msg || msg.type !== 'mlsAppWriteV2Request') return;");
assert(v2Start >= 0);
const v2Handler = background.slice(v2Start);
assert(/unknown-section-key/.test(v2Handler));
assert(/ambiguous-athena-tabs/.test(v2Handler));
assert(/__mlsWriteTarget/.test(v2Handler));
assert(!/mlsRecoverAthenaTab/.test(v2Handler), 'a possibly-started write must never reload/retry Athena');

const legacyBridge = between(content, "if (d.type === 'mlsAppPushVisit')", "if (d.type === 'mlsAppSearchProcedure')");
assert(/legacy-untyped-write-disabled/.test(legacyBridge));
assert(!/_mlsPushVisit\(/.test(legacyBridge), 'legacy mixed writer must be unreachable from the app bridge');

const genericExec = between(background, "if (msg.type === 'mlsAssistExec')", "if (msg.type === 'mlsPasteHere')");
for (const required of ['final-action-blocked', 'structured-route-blocked', 'Save, Sign, Submit']) {
  assert(genericExec.includes(required), `generic executor missing low-level guard: ${required}`);
}

const signHandler = between(background, "if (msg.type === 'MLS_OVL_SIGNSAVE')", "var OFFSCREEN_PATH = 'offscreen.html';");
assert(/msg\.userInitiated\s*!==\s*true/.test(signHandler), 'the legacy overlay sign route must still reject non-user actions');
assert(/probe/.test(signHandler), 'the legacy overlay route must preserve its read-only probe');
assert(/sign-route-disabled/.test(signHandler), 'the legacy overlay route must remain mutation-disabled; finalization belongs only to the supervised v2 action contract');
const prepHandler = between(background, "if (!msg || msg.type !== 'mlsAppPrepProcTemplateRequest') return;", 'function getCfg()');
assert(/procedure-template-mutation-disabled/.test(prepHandler));

// App-side aliases are resolved before crossing the bridge. This preserves the
// extension's fail-closed contract: the ambiguous legacy key never reaches it.
const appRoutesSource = between(writeflow, 'var EXEC_ALIAS = {', 'function gatherSections(panel)');
const appRoutes = Function(`var S = x => x == null ? '' : String(x);\n${appRoutesSource}\nreturn { canonicalSectionKey, EXEC_ALIAS, PREVIEW_ONLY, DESTINATION };`)();
assert.strictEqual(appRoutes.canonicalSectionKey('history').key, 'hpi');
assert.strictEqual(appRoutes.canonicalSectionKey('followup').key, 'plan');
assert.strictEqual(appRoutes.canonicalSectionKey('follow_up').key, 'plan');
assert.strictEqual(appRoutes.canonicalSectionKey('orders').previewOnly, true);
assert.strictEqual(appRoutes.canonicalSectionKey('billing').previewOnly, true);
assert.strictEqual(appRoutes.canonicalSectionKey('unknown_route'), null);

const gather = between(writeflow, 'function gatherSections(panel)', '/* --------------------------- result rendering');
assert(/errors\.push/.test(gather), 'unknown checked keys must be collected as hard errors');
assert(/held\.push/.test(gather), 'structured actions must remain held for manual review');
assert(/Follow-up:/.test(gather) && /byKey\[route\.key\]\.text \+=/.test(gather), 'follow-up must merge into the canonical Plan payload');

const runV2 = between(writeflow, 'function runV2(panel)', '/* -------------------- panel takeover');
assert(runV2.includes('openPanelUnifiedConfirmation'), 'advanced workspace must delegate to the unified manifest review');
assert(!/bridge\(\s*['"]mlsAppWriteV2['"]/.test(runV2), 'advanced workspace must not use the deprecated direct writer');
assert(!/startAthenaAction\(/.test(runV2), 'advanced workspace must not open the older per-action confirmation');
const resultUi = between(writeflow, 'function renderResp(logEl, resp, want)', '/* -------------------- unified review from the panel');
assert(/r\.written && r\.verified && durable/.test(resultUi), 'Done must require written, verified, and durable evidence');
assert(/persisted\|\|r\.serverVerified/.test(resultUi), 'durable evidence must be persisted or server verified');

// Full-visit/history controls open the destination review. The Superbill
// shortcut opens the same immutable review with a manual billing row; it must
// never start the typed billing executor (which is policy-blocked).
// A saved visit uses its immutable saved identity, never the active patient.
const fullVisit = between(app, 'function pushEntireVisitToAthena(btn)', '/* Legacy natural-language autopilot');
assert(fullVisit.includes('_athenaPushPlan'));
assert(!fullVisit.includes('postMessage'));
const fullPlan = between(app, 'function _athenaPushPlan(sections, who, immutablePatient', '/* Review card');
assert(!fullPlan.includes('postMessage'));
assert(fullPlan.includes('_athenaShowReceipt'));
const billingPlan = between(app, 'function pushSuperbillToAthena()', '/* Preview a SAVED visit');
assert(/openUnifiedConfirmation/.test(billingPlan), 'Superbill must open the immutable Athena review');
assert(/kind\s*:\s*['"]billing['"]/.test(billingPlan), 'Superbill review must retain the typed billing payload as a visible row');
assert(!/startAthenaAction\(['"]stage_billing['"]/.test(billingPlan), 'Superbill must not advertise or start billing execution');
assert(!billingPlan.includes('postMessage') && !/mode\s*:\s*['"]execute['"]/.test(billingPlan), 'Superbill must not bypass the review-only boundary');
const savedPlan = between(app, 'function pushHistoryNoteToAthena(id)', 'function getAutoSendEMR()');
assert(savedPlan.includes('_athenaBindingForSavedRecord(n)'), 'saved history must rebuild its immutable saved-record binding');
assert(savedPlan.includes('savedBinding.identityConflict'), 'saved history must fail closed when saved identity conflicts with the linked chart');
assert(!savedPlan.includes('activePatient'), 'saved history routing must not borrow the currently active patient');
assert(savedPlan.includes('_athenaPushPlan') && !savedPlan.includes('postMessage'));
assert(app.includes('function getAutoSendEMR(){ return false; }'));
/* b384: the inert auto-send checkbox was replaced by the guarantee stated as
   fact — Settings still communicates review-always / never-auto-send. */
assert(app.includes('MLS always stops for your review before anything reaches Athena'));
assert(!app.includes('id="autoSendEMR"'), 'the dead auto-send switch must not return');
assert(app.includes('Review EMR route'));
assert(!app.includes('Auto-send signed notes to the EMR'), 'settings must not promise a disabled automatic write');
assert(!app.includes('>📤 Send to EMR</button>'), 'preview-only controls must not be labeled as a send');

// Unsafe legacy loaders/messages remain absent from the final app bundle.
assert(!/window\.postMessage\([^\n]*mlsAppPushVisit/.test(app));
assert(!/window\.postMessage\([^\n]*mlsAppPushVisit/.test(connect));
assert(!/feat_mls_(?:easy_autosend|generic_writeback|unsafe_opnote)/.test(connect));

console.log('PASS athena write contract: typed routes, fail-closed holds, no false persistence, no legacy finalization');
