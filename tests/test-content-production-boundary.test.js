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
assert(safety && safety.version === 'wsg-1.1.0', 'write-safety guard did not load');

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
