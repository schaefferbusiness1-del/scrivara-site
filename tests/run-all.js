'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const tests = [
  'static-site.test.js',
  'athena-write-contract.test.js',
  'athena-action-contract.test.js',
  'athena-confirmation-runtime.test.js',
  'athena-confirmed-billing-contract.test.js',
  'athena-adversarial-contract.test.js',
  'primary-workflow-contract.test.js',
  'async-artifact-binding-contract.test.js',
  'async-artifact-source-guard.test.js',
  'note-editor-binding-contract.test.js',
  'dictate-anywhere-binding-contract.test.js',
  'record-backup-lifecycle.test.js',
  'autosave-patient-scope-runtime.test.js',
  'voice-ai-binding-contract.test.js',
  'copilot-request-binding-contract.test.js',
  'async-owner-guards.test.js',
  'history-duplicate-name-binding.test.js',
  'voice-dock-layout-contract.test.js',
  'portal-invite-placement-runtime.test.js',
  'patient-card-contrast-contract.test.js',
  'schedule-time-contract.test.js',
  'performance-lifecycle-contract.test.js',
  'extension-read-path.test.js',
  'extension-package.test.js'
];

for (const test of tests) {
  const file = path.join(__dirname, test);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log(`PASS all ${tests.length} local regression suites`);
