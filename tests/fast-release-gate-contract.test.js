'use strict';

/* Deterministic self-tests for the guarded fast gate.  These tests exercise
   only classification, refusal, map completeness, and output contracts. They
   deliberately never launch static-site, browser, package, or full-gate tests. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const gate = require('../scripts/fast-release-gate.js');

let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }
function eq(actual, expected, message) { checks++; assert.deepStrictEqual(actual, expected, message); }

function readCanonicalGateCount() {
  const source = fs.readFileSync(path.join(__dirname, 'run-all.js'), 'utf8');
  const start = source.indexOf('const tests = [');
  const end = source.indexOf('\n];', start);
  assert(start >= 0 && end > start, 'run-all.js must retain an explicit tests array');
  return vm.runInNewContext(`${source.slice(start, end + 3)}; tests.length`);
}

eq(gate.normalizePath('1p\\index.html'), '1p/index.html', 'Windows paths normalize to repository paths');
ok(!gate.ALLOWED_UNTRACKED.has('MLS_Assist_v3.0.79.zip'), 'stale packages are never silently allowed as untracked');
ok(!gate.ALLOWED_UNTRACKED.has('MLS_Assist_v3.0.81.zip'), 'current packages are never silently allowed as untracked');

const provenance = gate.classifyChangedFiles([
  'feat_athena_autopull.js',
  '1p-mls-connect.js',
  'mls-connect.js',
  'cloned-mls-connect.js',
]);
eq(provenance.scope, 'provenance', 'provenance map selects the provenance scope');
ok(provenance.eligible && !provenance.fullRequired, 'mapped provenance-only change is fast-gate eligible');
eq(provenance.unknown, [], 'all provenance files are explicitly mapped');
const missingDerived = gate.classifyChangedFiles(['1p-mls-connect.js']);
ok(missingDerived.fullRequired && !missingDerived.eligible, 'authoritative provenance changes require both derived outputs');
const derivedOnly = gate.classifyChangedFiles(['mls-connect.js']);
ok(derivedOnly.fullRequired && !derivedOnly.eligible, 'derived provenance output cannot change without its source');

const extension = gate.classifyChangedFiles(['background.js', 'manifest.json', 'extension-version.json']);
eq(extension.scope, 'extension', 'extension map selects the extension scope');
ok(extension.eligible && !extension.fullRequired, 'mapped extension-only change is fast-gate eligible');

const sharedShell = gate.classifyChangedFiles(['1p/index.html']);
ok(sharedShell.fullRequired && !sharedShell.eligible, 'shared shell changes cannot use the fast release lane');
ok(sharedShell.reasons.some((reason) => /shared shell/.test(reason)), 'shared-shell refusal is explicit');

const mixed = gate.classifyChangedFiles(['background.js', 'feat_athena_autopull.js']);
ok(mixed.fullRequired && !mixed.eligible, 'mixed scopes fail closed');
ok(mixed.reasons.some((reason) => /together/.test(reason)), 'mixed-scope refusal names the reason');

const unknown = gate.classifyChangedFiles(['new-shared-runtime.js']);
ok(unknown.fullRequired && !unknown.eligible, 'unmapped files require the full gate');
ok(unknown.reasons.some((reason) => /unmapped/.test(reason)), 'unmapped refusal is explicit');

const testEdit = gate.classifyChangedFiles(['tests/run-all.js']);
ok(testEdit.fullRequired && !testEdit.eligible, 'test registry edits require the full gate');
ok(testEdit.reasons.some((reason) => /test file changed/.test(reason)), 'test-registry refusal is explicit');

const releaseScript = gate.classifyChangedFiles(['scripts/public-release-preflight.js']);
ok(releaseScript.fullRequired && !releaseScript.eligible, 'release-script edits require the full gate');

const backend = gate.classifyChangedFiles(['backend/src/routes.js']);
ok(backend.fullRequired && !backend.eligible, 'backend edits require the full gate');

const status = gate.inspectWorktreeStatus([
  '?? MLS_Assist_v3.0.79.zip',
  '?? MLS_Assist_v3.0.79.bin',
]);
eq(status.disallowed.length, 2, 'both stale artifacts keep the worktree dirty');
eq(status.allowed.length, 0, 'no untracked release artifact is silently allowed');

const dirty = gate.inspectWorktreeStatus([' M ScribeFlow.html']);
ok(dirty.disallowed.length === 1, 'tracked modifications are never treated as clean');
assert.throws(() => gate.assertGitClean(dirty), /worktree is not clean/);
checks++;

const plan = gate.buildPlan(provenance);
ok(plan.invariants.length >= 8, 'every fast plan carries invariant release checks');
ok(plan.focused.some((step) => /profile-coherence/.test(step.label)), 'provenance plan includes browser profile coverage');
ok(plan.focused.some((step) => /source-browser/.test(step.label)), 'provenance plan includes the visible SOURCE-row browser proof');
ok(plan.focused.some((step) => /partial-provenance/.test(step.label)), 'provenance plan includes the new partial receipt test');
ok(plan.descriptors.every((step) => Array.isArray(step.args) && step.args[0].endsWith('.js')), 'every plan step names an executable JavaScript test/script');
eq(plan.fullGateTests, readCanonicalGateCount(), 'fast plan stays synchronized with the canonical suite count');

const e17Like = gate.classifyChangedFiles([
  ...provenance.changed,
  'tests/athena-autopull-partial-provenance.test.js',
  'tests/partial-athena-proof-carryforward.test.js',
  'tests/prep-summary-debris.test.js',
  'tests/run-all.js',
]);
ok(e17Like.scope === 'provenance' && e17Like.fullRequired && !e17Like.eligible,
  'e17-style registry changes get a focused precheck but cannot bypass the full gate');

assert.match(gate.usage(), /GATE_COMPLETE/);
checks++;
console.log(`PASS fast-release-gate-contract: ${checks} checks; no expensive suites launched`);
