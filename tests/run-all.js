'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const tests = [
  'static-site.test.js',
  'athena-write-contract.test.js',
  'athena-action-contract.test.js',
  'athena-confirmation-runtime.test.js',
  'athena-unified-manifest-contract.test.js',
  'orders-unified-review-contract.test.js',
  'orders-human-place-button.test.js',
  'athena-order-action-runtime.test.js',
  'athena-unified-confirmation-contract.test.js',
  'athena-unified-confirmation-runtime.test.js',
  'destination-teaching-runtime.test.js',
  'athena-advanced-unified-entry-contract.test.js',
  'athena-session-preservation-contract.test.js',
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
  'assistant-readiness-runtime.test.js',
  'copilot-request-binding-contract.test.js',
  'async-owner-guards.test.js',
  'history-duplicate-name-binding.test.js',
  'chart-refresh-merge-runtime.test.js',
  'provider-day-history-cards-runtime.test.js',
  'full-visit-reader-runtime.test.js',
  'history-organization-runtime.test.js',
  'history-organization-adversarial.test.js',
  'opnote-exact-patient-binding.test.js',
  'opnote-staging-identity-runtime.test.js',
  'staging-history-writeflow-parity.test.js',
  'active-patient-sync-status.test.js',
  'voice-dock-layout-contract.test.js',
  'portal-invite-placement-runtime.test.js',
  'patient-card-contrast-contract.test.js',
  'schedule-time-contract.test.js',
  'schedule-pull-integrity.test.js',
  'schedule-history-pipeline.test.js',
  'schedule-identity-adversarial-runtime.test.js',
  'provider-day-pull-contract.test.js',
  'provider-roster-integrity.test.js',
  'schedule-pull-ui-contract.test.js',
  'startup-explicit-pull-contract.test.js',
  'performance-lifecycle-contract.test.js',
  'extension-read-path.test.js',
  'extension-package.test.js'
  ,'portal-staff-booking-contract.test.js'
];

for (const test of tests) {
  const file = path.join(__dirname, test);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log(`PASS all ${tests.length} local regression suites`);
