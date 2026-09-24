'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const guardSource = fs.readFileSync(path.join(root, 'write_safety_guard.js'), 'utf8');
const backgroundSource = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const appBridgeSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(!/Adam J Schaeffer|7833832|TEST_RECIPIENT/.test(guardSource),
  'the shipped write guard still embeds a named production patient or MRN');
assert(!/Adam J Schaeffer|7833832/.test(backgroundSource),
  'the shipped worker still embeds the former production test patient identity');
assert(!/Adam J Schaeffer|7833832/.test(appBridgeSource),
  'the shipped app bridge still embeds the former production test patient identity');

const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(guardSource, sandbox, { filename: 'write_safety_guard.js' });
const safety = sandbox.MLSWriteSafety;
/* wsg-3.0.0 (draftonly-1.0.0, b1210): Athena execution is restricted to drafts. Sign, billing
   staging and order placement are refused by policy again; the test-content policy below is
   unchanged. athena-draft-only-execution.test.js owns the draft-only allowlist in depth; this suite
   pins the policy version its test-content checks run under, exactly. */
assert(safety && safety.version === 'wsg-3.0.0', 'write-safety guard did not load (wsg-3.0.0 = draft-only execution; the test-content policy below is unchanged)');
assert.deepStrictEqual(Object.keys(safety.BLOCKED_EXECUTE_ACTIONS || {}).sort(), ['place_order', 'sign_encounter', 'stage_billing'],
  'wsg-3.0.0: the policy-blocked execute actions are not exactly sign_encounter, stage_billing and place_order');
for (const action of ['sign_encounter', 'stage_billing', 'place_order']) {
  const refused = safety.gateActionRequest({ mode: 'execute', action, noteText: '' });
  assert(refused && refused.blocked === true && refused.ok === false,
    'wsg-3.0.0: ' + action + ' execute passed the policy gate');
  assert.strictEqual(refused.reason, 'write-safety-final-action-blocked',
    'wsg-3.0.0: ' + action + ' execute was refused for the wrong reason');
  assert.strictEqual(refused.action, action, 'wsg-3.0.0: the refusal does not name the action it refused');
  assert(/Nothing was changed/.test(String(refused.error || '')),
    'wsg-3.0.0: the ' + action + ' refusal does not say that nothing was changed');
}

const syntheticPatient = { name: 'Synthetic Preview Patient', mrn: 'SYN-1001' };
assert.strictEqual(safety.checkTestWritePolicy({ patient: syntheticPatient, noteText: 'Ordinary reviewed draft.' }), null,
  'ordinary production note text was incorrectly treated as test content');

for (const opts of [
  { patient: syntheticPatient, noteText: '[MLS TEST] harmless draft' },
  { patient: syntheticPatient, noteText: 'STAGING ONLY harmless draft' },
  { patient: syntheticPatient, noteText: 'harmless draft', isTest: true },
  { patient: { name: 'Any Patient', mrn: '7833832' }, noteText: '[MLS TEST] harmless draft' }
]) {
  const blocked = safety.checkTestWritePolicy(opts);
  assert(blocked && blocked.blocked && blocked.reason === 'test-content-production-disabled',
    'test/staging content did not fail closed at the production boundary');
  assert(/Preview sandbox/.test(blocked.error) && /Nothing was changed/.test(blocked.error),
    'test-content refusal does not explain the safe synthetic alternative');
}

const actionBlock = safety.gateActionRequest({
  mode: 'execute', action: 'save_draft', expectedPatient: syntheticPatient,
  noteText: '[MLS TEST] harmless draft'
});
assert(actionBlock && actionBlock.reason === 'test-content-production-disabled',
  'supervised save-draft lane bypassed the production test-content boundary');
assert(/else if \(mode === 'execute'\)/.test(backgroundSource),
  'worker does not fail closed for every execute action when the safety guard is missing');

console.log('PASS test-content boundary: no named production recipient; all test/staging writes require an explicit Preview sandbox');
